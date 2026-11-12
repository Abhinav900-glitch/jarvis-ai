// ---------------------------------------------------------------------------
// Music generation.
//
// A text model can describe a song; this makes one. Four providers are wired
// up and tried in the order the deployment actually has keys for:
//
//   Lyria 3.5 (Gemini)  GEMINI_API_KEY        one call, JSON with base64 audio
//   ElevenLabs Music    ELEVENLABS_API_KEY    mp3 bytes straight back
//   Loudly              LOUDLY_AI_API_KEY     a song object with an mp3 URL
//   Stable Audio (fal)  FAL_AI_API            a CDN URL to download
//   Replicate MusicGen  REPLICATE_API_TOKEN   30 s clips, URL output
//
// Every track is written into the user's cloud (same 512 MB quota as an
// upload, same delete button), so a generated song is a file they own rather
// than a link that expires. Whenever a provider fails the next one is tried and
// the reasons are reported together — "which key is missing" is the single most
// useful sentence to get back when nothing generated.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import { FAL_KEY_ENVS, readEnv } from "./imageProviders";

type ProviderId =
  | "lyria"
  | "elevenlabs"
  | "loudly"
  | "fal"
  | "replicate";

const PROVIDERS: readonly {
  id: ProviderId;
  label: string;
  /** Env var names that turn this provider on; the first non-empty one wins. */
  keys: readonly string[];
}[] = [
  {
    id: "lyria",
    label: "Lyria 3.5 (Gemini)",
    keys: ["AI_STUDIO_API_KEY", "GEMINI_API_KEY"],
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs Music",
    keys: ["ELEVENLABS_API_KEY"],
  },
  { id: "loudly", label: "Loudly", keys: ["LOUDLY_AI_API_KEY"] },
  { id: "fal", label: "Stable Audio (fal.ai)", keys: FAL_KEY_ENVS },
  {
    id: "replicate",
    label: "Replicate MusicGen",
    keys: ["REPLICATE_API_TOKEN"],
  },
];

/** A track shorter than this is a sound effect, not a song. */
const MIN_SECONDS = 10;
/** Long enough for a real piece, short enough to stay small in the cloud. */
const MAX_SECONDS = 120;

/** MusicGen's documented public version for meta/musicgen (stereo-large). */
const MUSICGEN_VERSION =
  "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb";

/** Formats come back as mp3/wav/ogg/m4a depending on the provider. */
function audioMime(bytes: Uint8Array): string {
  const ascii = (offset: number, text: string): boolean => {
    if (bytes.length < offset + text.length) return false;
    for (let i = 0; i < text.length; i++) {
      if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  if (ascii(0, "RIFF")) return "audio/wav";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(4, "ftyp")) return "audio/mp4";
  return "audio/mpeg"; // ID3 or a bare MPEG frame; ElevenLabs music is mp3.
}

/** True for the magic bytes of every container the providers return. */
function looksLikeAudio(bytes: Uint8Array): boolean {
  if (bytes.length < 512) return false;
  const ascii = (offset: number, text: string): boolean => {
    if (bytes.length < offset + text.length) return false;
    for (let i = 0; i < text.length; i++) {
      if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  };
  return (
    ascii(0, "RIFF") ||
    ascii(0, "ID3") ||
    ascii(0, "OggS") ||
    ascii(0, "fLaC") ||
    ascii(4, "ftyp") ||
    // MPEG frame sync: 11 set bits (0xFF 0xE0..0xFF).
    (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
  );
}

/**
 * Lyria answers with JSON, and the audio is a base64 string somewhere in it.
 * Rather than pinning one path (the shape differs between song and clip
 * models), walk the payload and take the first long base64 string that decodes
 * to real audio.
 */
function extractBase64Audio(value: unknown, depth = 0): Uint8Array | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.length < 1000) return null;
    const compact = value.replace(/\s+/g, "");
    if (compact.length % 4 === 1) return null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
    try {
      const binary = atob(compact);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return looksLikeAudio(bytes) ? bytes : null;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractBase64Audio(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = extractBase64Audio(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function downloadAudio(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!looksLikeAudio(bytes)) throw new Error("that was not audio");
  return bytes;
}

/** Provider 1 — Lyria 3.5 through the Gemini API's Interactions endpoint. */
async function lyriaTrack(prompt: string): Promise<Uint8Array> {
  // The Keys tab stores the AI Studio key under its own name; GEMINI_API_KEY
  // may hold a different (or older) Google credential.
  const key = readEnv(["AI_STUDIO_API_KEY", "GEMINI_API_KEY"]);
  if (!key) throw new Error("no AI_STUDIO_API_KEY set");

  // The full song model first, then the documented 30 s clip. A free-tier key
  // can be allowed zero requests/day on one and not the other, so both are
  // worth trying before reporting that the quota is spent.
  const models = ["lyria-3.5", "lyria-3-clip-preview"];
  let lastError = "";

  for (const model of models) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: prompt,
          response_format: { type: "audio" },
        }),
        signal: AbortSignal.timeout(180_000),
      },
    );

    const raw = await res.text();
    if (!res.ok) {
      console.error("Lyria error", model, res.status, raw.slice(0, 300));
      // The API explains itself in `error.message` (quota per day, tier, ...).
      const message = raw.match(/"message"\s*:\s*"([^"]{1,180})"/)?.[1];
      lastError =
        res.status === 401 || res.status === 403
          ? `key rejected (${res.status})`
          : (message ??
            (res.status === 429
              ? "rate limited or out of quota"
              : `request failed (${res.status})`));
      // Only a model this key cannot use is worth retrying on the other one.
      if (res.status === 404 || res.status === 429) continue;
      throw new Error(lastError);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("unreadable response");
    }

    const bytes = extractBase64Audio(payload);
    if (bytes) return bytes;
    lastError = raw.match(/"message"\s*:\s*"([^"]{1,160})"/)?.[1] ?? "returned no audio";
  }

  throw new Error(lastError || "returned no audio");
}

/** Provider 2 — ElevenLabs Music. Returns mp3 bytes; needs a paid plan. */
async function elevenLabsTrack(
  prompt: string,
  seconds: number,
  instrumental: boolean,
): Promise<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("no ELEVENLABS_API_KEY set");

  const res = await fetch(
    "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        prompt,
        // Documented range is 3 s – 10 min; ours is already narrower.
        music_length_ms: seconds * 1000,
        model_id: "music_v1",
        ...(instrumental ? { force_instrumental: true } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("ElevenLabs music error", res.status, text.slice(0, 300));
    throw new Error(
      res.status === 401 || res.status === 403
        ? "key rejected for music"
        : res.status === 402
          ? "the plan does not include the Music API"
          : `request failed (${res.status})`,
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!looksLikeAudio(bytes)) throw new Error("empty audio");
  return bytes;
}

/**
 * Provider 3 — Loudly. Takes a multipart prompt and answers with a song object
 * whose `music_file_path_mp3` is the finished file.
 */
async function loudlyTrack(prompt: string, seconds: number): Promise<Uint8Array> {
  const key = process.env.LOUDLY_AI_API_KEY;
  if (!key) throw new Error("no LOUDLY_AI_API_KEY set");

  const form = new FormData();
  form.append("prompt", prompt);
  // Loudly's own range is 30–420 s, so short requests are rounded up.
  form.append("duration", String(Math.min(420, Math.max(30, Math.round(seconds)))));
  form.append("model", "VEGA_2");

  const res = await fetch("https://soundtracks.loudly.com/api/ai/prompt/songs", {
    method: "POST",
    headers: { "API-KEY": key },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Loudly error", res.status, text.slice(0, 300));
    const reason = text.match(/"error_description"\s*:\s*"([^"]{1,160})"/)?.[1];
    throw new Error(reason ?? `request failed (${res.status})`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const audioUrl =
    (typeof data.music_file_path_mp3 === "string" && data.music_file_path_mp3) ||
    Object.values(data).find(
      (value): value is string =>
        typeof value === "string" && /^https?:\/\/.+\.(mp3|wav)$/i.test(value),
    );
  if (!audioUrl) throw new Error("no downloadable track in the response");
  return await downloadAudio(audioUrl);
}

/** Provider 4 — MusicGen on Replicate. Clips top out at 30 seconds. */
async function replicateTrack(prompt: string, seconds: number): Promise<Uint8Array> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("no REPLICATE_API_TOKEN set");

  const input = {
    prompt,
    duration: Math.min(30, Math.max(5, Math.round(seconds))),
    model_version: "stereo-large",
    output_format: "mp3",
    normalization: true,
  };
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    // Blocks until the prediction finishes, so most calls need no polling.
    Prefer: "wait",
  };

  const create = async (): Promise<Response> => {
    const res = await fetch(
      "https://api.replicate.com/v1/models/meta/musicgen/predictions",
      { method: "POST", headers, body: JSON.stringify({ input }), signal: AbortSignal.timeout(120_000) },
    );
    if (res.status !== 404 && res.status !== 405 && res.status !== 422) return res;
    // Not an official model: it needs an explicit version. Retry rather than
    // reporting a failure the user cannot act on.
    await res.text().catch(() => "");
    return await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers,
      body: JSON.stringify({ version: MUSICGEN_VERSION, input }),
      signal: AbortSignal.timeout(120_000),
    });
  };

  let res = await create();
  // An account without a payment method is throttled to a burst of one, and
  // the first call of a session is often the one that trips it. Waiting out
  // `retry_after` is cheaper than making the user press Generate again.
  for (let attempt = 0; attempt < 2 && res.status === 429; attempt++) {
    const text = await res.text().catch(() => "");
    const after = Number(text.match(/"retry_after"\s*:\s*(\d+)/)?.[1]);
    const wait = Math.min(20, Number.isFinite(after) && after > 0 ? after : 10);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await create();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Replicate music error", res.status, text.slice(0, 300));
    throw new Error(`request failed (${res.status})`);
  }

  type Prediction = {
    status?: string;
    output?: string | string[] | null;
    error?: string | null;
    urls?: { get?: string };
  };
  let data = (await res.json()) as Prediction;
  for (let i = 0; i < 24; i++) {
    if (data.status === "succeeded" || data.status === "failed" || data.status === "canceled") {
      break;
    }
    const getUrl = data.urls?.get;
    if (!getUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const poll = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!poll.ok) break;
    data = (await poll.json()) as Prediction;
  }

  if (data.status !== "succeeded") {
    throw new Error(data.error ?? `generation ${data.status ?? "did not finish"}`);
  }
  const out = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!out) throw new Error("no audio in the prediction");
  return await downloadAudio(out);
}

/**
 * Provider 5 — Stable Audio 3 Medium on fal.ai.
 *
 * This is where the Hugging Face token lands. hf-inference serves no
 * text-to-audio model — the router answers 400 "Model not supported by
 * provider hf-inference" for MusicGen — and the only live inference mapping
 * for a music model in the HF catalog is fal-ai, which this reaches directly
 * with the account's own fal key.
 */
async function falTrack(prompt: string, seconds: number): Promise<Uint8Array> {
  const key = readEnv(FAL_KEY_ENVS);
  if (!key) throw new Error("no FAL_AI_API set");

  const res = await fetch(
    "https://fal.run/fal-ai/stable-audio-3/medium/text-to-audio",
    {
      method: "POST",
      headers: {
        // fal's own scheme, not Bearer — sending Bearer returns 401.
        authorization: `Key ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        // The endpoint takes 1–380 s; ours is already narrower.
        duration: Math.min(380, Math.max(1, Math.round(seconds))),
        output_format: "mp3",
        bitrate: "192k",
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("fal music error", res.status, text.slice(0, 300));
    // fal explains billing problems in `detail` ("Exhausted balance"), which
    // is far more useful than the status code.
    const detail = text.match(/"detail"\s*:\s*"([^"]{1,160})"/)?.[1];
    throw new Error(
      detail ??
        (res.status === 401 || res.status === 403
          ? "key rejected"
          : res.status === 402
            ? "out of fal credits"
            : `request failed (${res.status})`),
    );
  }

  const data = (await res.json().catch(() => null)) as {
    audio?: { url?: string };
  } | null;
  const url = data?.audio?.url;
  if (!url) throw new Error("no audio in the response");
  return await downloadAudio(url);
}

async function makeTrack(
  provider: ProviderId,
  prompt: string,
  seconds: number,
  instrumental: boolean,
): Promise<Uint8Array> {
  switch (provider) {
    case "lyria":
      return await lyriaTrack(prompt);
    case "elevenlabs":
      return await elevenLabsTrack(prompt, seconds, instrumental);
    case "loudly":
      return await loudlyTrack(prompt, seconds);
    case "fal":
      return await falTrack(prompt, seconds);
    case "replicate":
      return await replicateTrack(prompt, seconds);
  }
}

/** A filename that says what the file is, without inventing a title. */
function trackName(prompt: string, mime: string): string {
  const slug =
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .filter(Boolean)
      .slice(0, 5)
      .join("-")
      .slice(0, 40) || "track";
  const ext =
    mime === "audio/wav"
      ? "wav"
      : mime === "audio/ogg"
        ? "ogg"
        : mime === "audio/mp4"
          ? "m4a"
          : mime === "audio/flac"
            ? "flac"
            : "mp3";
  return `jarvis-music-${slug}-${Date.now()}.${ext}`;
}

/** Which providers this deployment can actually reach, for the panel's hint. */
export const providers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      available: readEnv(provider.keys) !== null,
    }));
  },
});

export const generate = action({
  args: {
    prompt: v.string(),
    seconds: v.optional(v.number()),
    instrumental: v.optional(v.boolean()),
    /** Pin one provider; omitted means "whichever key works, in order". */
    provider: v.optional(
      v.union(
        v.literal("auto"),
        v.literal("lyria"),
        v.literal("elevenlabs"),
        v.literal("loudly"),
        v.literal("fal"),
        v.literal("replicate"),
      ),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    id: string;
    url: string | null;
    name: string;
    provider: ProviderId;
    label: string;
    seconds: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to generate music.");

    const prompt = args.prompt.trim().slice(0, 800);
    if (prompt.length < 3) throw new Error("Describe the track you want.");
    const seconds = Math.min(
      MAX_SECONDS,
      Math.max(MIN_SECONDS, Math.round(args.seconds ?? 45)),
    );
    const instrumental = args.instrumental ?? true;

    const candidates = args.provider
      ? PROVIDERS.filter((provider) => provider.id === args.provider)
      : PROVIDERS;

    // Try in order, but do the expensive part once: the first provider that
    // returns audio wins and the rest are never called.
    let bytes: Uint8Array | null = null;
    let used: (typeof PROVIDERS)[number] | null = null;
    const failures: string[] = [];

    for (const candidate of candidates) {
      if (!readEnv(candidate.keys)) {
        failures.push(`${candidate.label}: no ${candidate.keys.join(" / ")}`);
        continue;
      }
      try {
        bytes = await makeTrack(candidate.id, prompt, seconds, instrumental);
        used = candidate;
        break;
      } catch (err) {
        const reason = err instanceof Error ? err.message : "failed";
        failures.push(`${candidate.label}: ${reason}`);
      }
    }

    if (!bytes || !used) {
      throw new Error(failures.join(" · ") || "No music provider is configured.");
    }

    const mime = audioMime(bytes);
    const name = trackName(prompt, mime);
    const storageId = await ctx.storage.store(
      new Blob([bytes.buffer as ArrayBuffer], { type: mime }),
    );
    // Same quota, same panel, same delete as any other file: a track the user
    // generated is simply a file in their cloud.
    const id = await ctx.runMutation(api.cloud.save, {
      storageId,
      name,
      mime,
      size: bytes.byteLength,
      source: "music",
    });

    return {
      id,
      url: await ctx.storage.getUrl(storageId),
      name,
      provider: used.id,
      label: used.label,
      seconds,
    };
  },
});
