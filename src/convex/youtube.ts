"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  buildComparisonContext,
  buildVideoContext,
  formatTranscript,
  MAX_VIDEOS_PER_TURN,
  parseYouTubeUrl,
  perVideoBudget,
  TOTAL_TRANSCRIPT_BUDGET,
  type TranscriptSegment,
  type VideoContextInput,
  type YouTubeRef,
} from "../lib/youtube";

// ---------------------------------------------------------------------------
// YouTube research.
//
// The goal is that a user can paste a YouTube link into the chat and have the
// transcript read and discussed, with the video's own title and channel
// alongside it.
//
// Why this needs a hosted provider rather than a direct fetch:
//
//   The obvious approach is to read the caption tracks out of the watch page's
//   player response and fetch them, which is exactly what the Python
//   youtube-transcript-api library does. That works from a laptop. It does not
//   work from here, and that is not a fixable bug in this code.
//
//   Measured on this deployment: the caption track URLs ARE present in the
//   watch page, the transcript endpoint answers HTTP 200 — and returns a
//   zero-byte body. Every route behaves the same way: signed track URLs,
//   unsigned /api/timedtext, the video.google.com host, a video with
//   human-authored rather than auto-generated captions, and repeated attempts.
//   YouTube serves caption data to residential IPs and withholds it from cloud
//   ranges, so a Convex action gets an empty body however it asks.
//
//   So metadata and transcripts come from two different places. Metadata is
//   read from YouTube's own public oEmbed endpoint, which needs no key and
//   works fine. Transcripts come from a hosted service, and the environment
//   variable for it is optional — without it the feature says plainly that it
//   cannot read the video rather than pretending to.
//
// Keys are read server-side only. A key in a web page is a public key.
// ---------------------------------------------------------------------------

/** Supadata's transcript endpoint, used when a key is configured. */
const TRANSCRIPT_URL = "https://api.supadata.ai/v1/transcript";

/** YouTube's own no-auth metadata endpoint. */
const OEMBED_URL = "https://www.youtube.com/oembed";

/**
 * Transcript budget. Large enough to cover a long talk in full, small enough
 * that the transcript cannot crowd out the conversation from the context
 * window.
 */
const MAX_TRANSCRIPT_CHARS = 24000;

const UA = "Mozilla/5.0 (compatible; JarvisBot/1.0; +https://jarvis.ai)";

function supadataKey(): string | null {
  const key = process.env.SUPADATA_API_KEY ?? process.env.SUPADATA_KEY;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export interface YouTubeResult {
  ok: boolean;
  videoId: string;
  url: string;
  title: string | null;
  channel: string | null;
  /** Transcript as readable prose, or empty when it could not be fetched. */
  transcript: string;
  segmentCount: number;
  truncated: boolean;
  language: string | null;
  /** True when the video has captions but the provider could not be reached. */
  transcriptUnavailable: boolean;
  /** Why the transcript is missing, phrased for the user rather than a log. */
  transcriptNote: string | null;
  /** Whether the feature is usable at all right now. */
  configured: boolean;
  /** Everything the model needs, ready to paste into a prompt. */
  context: string;
  ms: number;
}

/**
 * Read a video's metadata and transcript.
 *
 * Metadata and transcript are fetched independently and neither failure hides
 * the other, because a video with a known title but no readable transcript is
 * still worth answering from: the model can say what the video is and be clear
 * that it could not read the content, instead of inventing a summary.
 */
export const getVideo = action({
  args: {
    url: v.string(),
    /** Cap on transcript characters handed to the model. */
    maxChars: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<YouTubeResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to read a YouTube video.");

    const startedAt = Date.now();

    const ref = parseYouTubeUrl(args.url);
    if (!ref) {
      throw new Error(
        "That does not look like a YouTube link. Paste a video URL such as https://www.youtube.com/watch?v=…",
      );
    }

    const [metadata, transcriptOutcome] = await Promise.all([
      fetchMetadata(ref),
      fetchTranscript(ref),
    ]);

    const maxChars = Math.min(Math.max(args.maxChars ?? MAX_TRANSCRIPT_CHARS, 1000), MAX_TRANSCRIPT_CHARS);
    const formatted = formatTranscript(transcriptOutcome.segments, { maxChars });

    const context = buildVideoContext({
      title: metadata.title,
      channel: metadata.channel,
      videoId: ref.videoId,
      url: ref.url,
      transcript: formatted.text,
      truncated: formatted.truncated,
      segmentCount: formatted.segmentCount,
    });

    return {
      ok: true,
      videoId: ref.videoId,
      url: ref.url,
      title: metadata.title,
      channel: metadata.channel,
      transcript: formatted.text,
      segmentCount: formatted.segmentCount,
      truncated: formatted.truncated,
      language: transcriptOutcome.language,
      transcriptUnavailable: formatted.segmentCount === 0,
      transcriptNote: formatted.segmentCount === 0 ? transcriptOutcome.note : null,
      configured: supadataKey() !== null,
      context,
      ms: Date.now() - startedAt,
    };
  },
});

interface VideoMetadata {
  title: string | null;
  channel: string | null;
}

/**
 * Title and channel from YouTube's oEmbed endpoint.
 *
 * This is a documented, no-auth, deliberately minimal endpoint — it returns
 * only what an embed needs — which makes it the one part of YouTube that works
 * from a server. When it fails the feature still proceeds, just without names.
 */
async function fetchMetadata(ref: YouTubeRef): Promise<VideoMetadata> {
  try {
    const url = `${OEMBED_URL}?url=${encodeURIComponent(ref.url)}&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { title: null, channel: null };
    const body = (await res.json()) as { title?: string; author_name?: string };
    return {
      title: body.title?.trim() || null,
      channel: body.author_name?.trim() || null,
    };
  } catch {
    // Metadata is a nicety; a missing title must not fail the whole request.
    return { title: null, channel: null };
  }
}

interface TranscriptOutcome {
  segments: TranscriptSegment[];
  language: string | null;
  note: string | null;
}

/**
 * The transcript, from whichever provider is configured.
 *
 * Returns segments plus a note explaining itself when there are none, because
 * "no transcript" and "the provider is down" and "this video has no captions"
 * call for very different responses from the user.
 */
async function fetchTranscript(ref: YouTubeRef): Promise<TranscriptOutcome> {
  const key = supadataKey();
  if (!key) {
    return {
      segments: [],
      language: null,
      note:
        "Jarvis cannot read YouTube transcripts yet. Add SUPADATA_API_KEY from supadata.ai in the API keys tab to enable it. YouTube does not serve captions to servers, so the transcript has to come from a hosted provider.",
    };
  }

  let res: Response;
  try {
    res = await fetch(`${TRANSCRIPT_URL}?url=${encodeURIComponent(ref.url)}`, {
      headers: { "x-api-key": key, "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      segments: [],
      language: null,
      note: timedOut
        ? "The transcript provider did not answer in time. Try again in a moment."
        : "Could not reach the transcript provider.",
    };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      return {
        segments: [],
        language: null,
        note: "The transcript provider rejected SUPADATA_API_KEY. Check it in the API keys tab.",
      };
    }
    if (res.status === 429) {
      return {
        segments: [],
        language: null,
        note: "The transcript provider's free allowance is used up. It resets monthly, or a paid plan removes the limit.",
      };
    }
    if (res.status === 404) {
      return {
        segments: [],
        language: null,
        note: "That video has no captions available, so there is no transcript to read.",
      };
    }
    return {
      segments: [],
      language: null,
      note: `The transcript provider returned an error (HTTP ${res.status})${
        detail ? `: ${detail.slice(0, 160)}` : "."
      }`,
    };
  }

  let body: { lang?: string; content?: Array<{ text?: string; offset?: number }> };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { segments: [], language: null, note: "The transcript provider sent something unreadable." };
  }

  const segments: TranscriptSegment[] = (body.content ?? [])
    .map((segment) => ({
      text: segment.text ?? "",
      // Supadata reports milliseconds.
      offsetSeconds: (segment.offset ?? 0) / 1000,
    }))
    .filter((segment) => segment.text.trim());

  if (segments.length === 0) {
    return {
      segments: [],
      language: body.lang ?? null,
      note: "That video has no captions available, so there is no transcript to read.",
    };
  }

  return { segments, language: body.lang ?? null, note: null };
}
/** One video's result within a batch. */
type VideoResult = Omit<VideoContextInput, "index"> & {
  index: number;
  transcriptUnavailable: boolean;
  transcriptNote: string | null;
};

interface BatchResult {
  videos: VideoResult[];
  /** Videos whose transcript could actually be read. */
  readableCount: number;
  /** Videos dropped to respect the per-turn cap, if any. */
  skipped: number;
  /** Links that were not YouTube videos at all. */
  rejected: string[];
  context: string;
  configured: boolean;
  ms: number;
}

/**
 * Read several videos at once, for comparing them.
 *
 * Each video is fetched independently and independently reported on, because
 * the whole point is to compare them: if one link is private, deleted, or has
 * no captions, the other videos are still worth reading, and a batch that
 * failed as a unit would throw away four good transcripts over one bad link.
 *
 * Fetches run in parallel. They are capped rather than unbounded so a message
 * with a dozen links cannot turn into a dozen simultaneous paid requests.
 */
export const getVideos = action({
  args: {
    urls: v.array(v.string()),
    /** Cap on total transcript characters across every video. */
    maxTotalChars: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BatchResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to read YouTube videos.");

    const startedAt = Date.now();

    // Parse first and drop anything that is not a video link, so the cap is
    // applied to real videos rather than to whatever was pasted.
    const parsed: YouTubeRef[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const raw of args.urls) {
      const ref = parseYouTubeUrl(raw);
      if (!ref) {
        rejected.push(raw.trim().slice(0, 120));
        continue;
      }
      // The same video pasted twice is one video, not two.
      if (seen.has(ref.videoId)) continue;
      seen.add(ref.videoId);
      parsed.push(ref);
    }

    if (parsed.length === 0) {
      throw new Error(
        "None of those links looked like YouTube videos. Paste links such as https://www.youtube.com/watch?v=…",
      );
    }

    const overflow = parsed.length - MAX_VIDEOS_PER_TURN;
    const limited = parsed.slice(0, MAX_VIDEOS_PER_TURN);

    const budget = Math.min(
      args.maxTotalChars ?? TOTAL_TRANSCRIPT_BUDGET,
      TOTAL_TRANSCRIPT_BUDGET,
    );
    const perVideo = perVideoBudget(limited.length, budget);

    const videos = await Promise.all(
      limited.map(async (ref, i): Promise<VideoResult> => {
        try {
          const [metadata, transcript] = await Promise.all([
            fetchMetadata(ref),
            fetchTranscript(ref),
          ]);
          const formatted = formatTranscript(transcript.segments, {
            maxChars: perVideo,
          });
          return {
            index: i + 1,
            videoId: ref.videoId,
            url: ref.url,
            title: metadata.title,
            channel: metadata.channel,
            transcript: formatted.text,
            segmentCount: formatted.segmentCount,
            truncated: formatted.truncated,
            transcriptUnavailable: formatted.segmentCount === 0,
            transcriptNote: formatted.segmentCount === 0 ? transcript.note : null,
          };
        } catch (err) {
          // One unreachable video must not fail the batch.
          return {
            index: i + 1,
            videoId: ref.videoId,
            url: ref.url,
            title: null,
            channel: null,
            transcript: "",
            segmentCount: 0,
            truncated: false,
            transcriptUnavailable: true,
            transcriptNote:
              err instanceof Error ? err.message : "This video could not be read.",
          };
        }
      }),
    );

    const readable = videos.filter((x) => !x.transcriptUnavailable);

    return {
      videos,
      /** Videos whose transcript could actually be read. */
      readableCount: readable.length,
      /** Videos dropped to respect the per-turn cap, if any. */
      skipped: overflow > 0 ? overflow : 0,
      /** Links that were not YouTube videos at all. */
      rejected,
      context: buildComparisonContext(videos),
      configured: supadataKey() !== null,
      ms: Date.now() - startedAt,
    };
  },
});
