"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as internalApi } from "./_generated/api";
import { sanitizeForSpeech } from "../lib/speech";
import { getSarvamLanguage, isIndicLangTag } from "../lib/languages";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// AssemblyAI — speech-to-text with audio intelligence (sentiment, chapters)
// ---------------------------------------------------------------------------

/** Upload raw audio bytes to AssemblyAI and return a public upload URL. */
async function uploadToAssemblyAI(
  key: string,
  audio: ArrayBuffer,
): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/v2/upload`, {
    method: "POST",
    headers: {
      authorization: key,
      "content-type": "application/octet-stream",
    },
    body: audio,
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI upload failed (${res.status})`);
  }
  const data = (await res.json()) as { upload_url?: string };
  if (!data.upload_url) throw new Error("AssemblyAI upload returned no URL");
  return data.upload_url;
}

/** Start a transcription with audio-intelligence features enabled. */
async function createTranscript(
  key: string,
  audioUrl: string,
  enableChapters: boolean,
): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/v2/transcript`, {
    method: "POST",
    headers: {
      authorization: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      sentiment_analysis: true,
      // Chapters give a "what was said" summary for longer notes.
      chapterization: enableChapters,
    }),
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI transcript request failed (${res.status})`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("AssemblyAI did not return a transcript id");
  return data.id;
}

interface TranscriptResult {
  text: string;
  summary?: string;
  sentiment: { positive: number; neutral: number; negative: number };
  chapters?: { headline: string; summary: string }[];
}

/** Poll AssemblyAI until the transcript completes or fails. */
async function pollTranscript(key: string, id: string): Promise<TranscriptResult> {
  const deadline = Date.now() + 90_000; // 90s cap — voice notes are short
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${ASSEMBLYAI_BASE}/v2/transcript/${id}`, {
      headers: { authorization: key },
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI poll failed (${res.status})`);
    }
    const t = (await res.json()) as {
      status: string;
      error?: string;
      text?: string;
      chapters?: { headline: string; summary: string }[];
      sentiment_analysis_results?: { sentiment: string }[];
    };
    if (t.status === "error") {
      throw new Error(`AssemblyAI error: ${t.error ?? "transcription failed"}`);
    }
    if (t.status === "completed") {
      const counts = { positive: 0, neutral: 0, negative: 0 };
      for (const r of t.sentiment_analysis_results ?? []) {
        if (r.sentiment === "POSITIVE") counts.positive++;
        else if (r.sentiment === "NEGATIVE") counts.negative++;
        else counts.neutral++;
      }
      const total = counts.positive + counts.neutral + counts.negative;
      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
      return {
        text: t.text ?? "",
        summary: t.chapters?.[0]?.summary,
        sentiment: {
          positive: pct(counts.positive),
          neutral: pct(counts.neutral),
          negative: pct(counts.negative),
        },
        chapters: t.chapters?.slice(0, 3),
      };
    }
  }
  throw new Error("Transcription timed out — try again in a moment.");
}

/** Transcribe a recorded voice note with AssemblyAI audio intelligence. */
export const transcribe = action({
  args: { audio: v.bytes() },
  handler: async (ctx, args): Promise<TranscriptResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use voice input.");

    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) {
      throw new Error(
        "ASSEMBLYAI_API_KEY is not configured. Add it in the Keys tab to enable voice transcription.",
      );
    }

    if (args.audio.byteLength === 0) throw new Error("Empty audio recording.");
    if (args.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Recording too large — keep voice notes under 20 MB.");
    }

    const uploadUrl = await uploadToAssemblyAI(key, args.audio);
    const id = await createTranscript(
      key,
      uploadUrl,
      args.audio.byteLength > 500_000,
    );
    const result = await pollTranscript(key, id);

    if (!result.text.trim()) {
      throw new Error("No speech detected in the recording.");
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Groq Whisper STT — fast multilingual speech-to-text (live mode engine)
// whisper-large-v3 transcribes in milliseconds and handles Hindi, Russian,
// English, and 90+ other languages natively.
// ---------------------------------------------------------------------------

export const transcribeWhisper = action({
  args: {
    audio: v.bytes(),
    language: v.optional(v.string()), // ISO-639-1 hint e.g. "hi", "ru", "en"
  },
  handler: async (ctx, args): Promise<{ text: string; language: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use voice.");

    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY is not configured.");
    }
    if (args.audio.byteLength === 0) throw new Error("Empty recording.");
    if (args.audio.byteLength > 25 * 1024 * 1024) {
      throw new Error("Recording too large — keep clips under 25 MB.");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([args.audio], { type: "audio/webm" }),
      "speech.webm",
    );
    form.append("model", "whisper-large-v3");
    // verbose_json is what carries `no_speech_prob` and the segment timings.
    // Without it we cannot tell "the user was quiet" from "the user said
    // something", which is exactly the distinction live mode has to get right.
    form.append("response_format", "verbose_json");
    // Fall back through increasingly creative temperatures only on failure:
    // a noisy clip at 0 often comes back empty, and a bad first guess should
    // not end the turn.
    form.append("temperature", "0");
    // Bias short clips toward real speech instead of Whisper's usual
    // hallucinated filler, and keep greetings transcribed as greetings.
    form.append(
      "prompt",
      "Live voice assistant session. The user says short utterances to a voice assistant, such as: hello, hi, thanks, yes, no, stop, what is the weather, tell me a joke.",
    );
    if (args.language) {
      form.append("language", args.language);
    }

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Groq Whisper error", res.status, errText.slice(0, 300));
      throw new Error(`Transcription failed (${res.status}): ${errText.slice(0, 150)}`);
    }

    const data = (await res.json()) as {
      text?: string;
      language?: string;
      segments?: Array<{ start?: number; end?: number; no_speech_prob?: number }>;
      no_speech_prob?: number;
    };

    // An empty transcript is a valid outcome for a very short clip — the live
    // loop just resumes listening. Throwing here surfaced a red error for
    // ordinary quiet utterances like a soft "hello".
    let text = (data.text ?? "").trim();

    // Whisper hallucinates fluent nonsense on near-silence (doors, fans, a
    // breath). It reports low confidence for those, so drop the text when the
    // model itself says it heard nothing. This is the single biggest source of
    // Jarvis talking to himself in a quiet room.
    const noSpeech = Math.max(
      data.no_speech_prob ?? 0,
      ...(data.segments ?? []).map((s) => s.no_speech_prob ?? 0),
    );
    if (text && noSpeech > 0.6) text = "";

    // Strip the tag/parenthetical artefacts Whisper emits for non-speech —
    // "[BLANK_AUDIO]", "(wind blowing)", "[MUSIC]" — rather than passing them
    // to the LLM as if the user had said them. Matched against a known list
    // rather than every bracketed span, so a user who actually says "[note]"
    // keeps it.
    text = text
      .replace(
        /\[\s*(blank_audio|silence|inaudible|music|applause|noise|sound|laughter|applause|upbeat music|background noise)[^\]]*\]/gi,
        " ",
      )
      .replace(
        /\(\s*(inaudible|silence|wind blowing|background noise|music|applause|laughter|no audio|crosstalk)[^)]*\)/gi,
        " ",
      )
      .replace(/\s{2,}/g, " ")
      .trim();

    return { text, language: data.language ?? args.language ?? "en" };
  },
});

// ---------------------------------------------------------------------------
// Groq PlayAI TTS — Jarvis speaks back (uses the existing GROQ_API_KEY)
// ---------------------------------------------------------------------------

// Groq PlayAI TTS. Voices are passed to the API as "<Name> — PlayAI".
const TTS_VOICES = [
  "Celeste",
  "River",
  "Leo",
  "Mia",
  "Zac",
  "Zoe",
  "Alex",
  "Ethan",
] as const;

const TTS_FALLBACK_VOICE = "Celeste";

// ---------------------------------------------------------------------------
// ElevenLabs TTS — second fallback for Jarvis's voice.
// Activates automatically when ELEVENLABS_API_KEY is set (Keys tab) and Groq
// TTS is unavailable (no Groq key / model terms not accepted / model error).
// eleven_turbo_v2_5 is fast, multilingual (Hindi, Russian, Arabic, ...) and
// cheap — a good match for the multi-country live mode.
//
// Voice selection order: ELEVENLABS_VOICE (name or id) → ELEVENLABS_VOICE_ID
// → the voice passed by the client → ELEVENLABS_DEFAULT_VOICE.
//
// Every id below was verified to return real audio on a free plan. Rachel and
// other popular voices return 402 "paid_plan_required" for free users via the
// API, so they are intentionally absent.
// ---------------------------------------------------------------------------
const ELEVENLABS_VOICES: Record<string, string> = {
  brian: "nPczCjzI2devNBz1zQrb", // deep, resonant — Jarvis default
  sarah: "EXAVITQu4vr4xnSDxMaL", // mature, reassuring, confident
  daniel: "onwK4e9ZLuTAKqWW03F9", // steady broadcaster
  adam: "pNInz6obpgDQGcFmaJgB", // dominant, firm
  roger: "CwhRBWXzGAHq8TQ4Fs17", // laid-back, casual
  chris: "iP95p4xoKVk53GoZ742B", // charming, down-to-earth
  alice: "Xb7hH8MSUJpSbSDYk0k2", // clear, engaging educator
  george: "JBFqnCBsd6RMkjVDRZzb", // warm, captivating storyteller
  matilda: "XrExE9yKIg1WjnnlVkGX", // knowledgeable, professional
  river: "SAz9YHcvj6GT2YYXdXww", // relaxed, neutral, informative
};

const ELEVENLABS_DEFAULT_VOICE = "brian";

/** Resolve a voice name ("sarah") or raw ElevenLabs voice id to an id. */
function resolveElevenLabsVoice(requested?: string): string {
  for (const candidate of [
    process.env.ELEVENLABS_VOICE,
    process.env.ELEVENLABS_VOICE_ID,
    requested,
  ]) {
    const value = candidate?.trim();
    if (!value) continue;
    const named = ELEVENLABS_VOICES[value.toLowerCase()];
    if (named) return named;
    // A raw ElevenLabs voice id is a 20-char alphanumeric token.
    if (/^[a-zA-Z0-9]{20}$/.test(value)) return value;
  }
  return ELEVENLABS_VOICES[ELEVENLABS_DEFAULT_VOICE];
}

async function speakWithElevenLabs(
  text: string,
  preferredVoice?: string,
): Promise<{ audio: ArrayBuffer | null; voice: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { audio: null, voice: "browser" };

  const voiceId = resolveElevenLabsVoice(preferredVoice);
  // Speak the message, never the markup: strip markdown/math/links first.
  const clipped = sanitizeForSpeech(text, 2400); // keep latency + cost sane
  if (!clipped) return { audio: null, voice: "browser" };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: clipped,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("ElevenLabs TTS error", res.status, errText.slice(0, 300));
      return { audio: null, voice: "browser" };
    }
    return { audio: await res.arrayBuffer(), voice: "elevenlabs" };
  } catch (err) {
    console.error("ElevenLabs TTS failed:", err instanceof Error ? err.message : err);
    return { audio: null, voice: "browser" };
  }
}

// ---------------------------------------------------------------------------
// Sarvam TTS — the Indic-language fallback (and first choice for them).
//
// Groq's Orpheus model is English-only and ElevenLabs is multilingual but
// generic, so for Hindi, Tamil, Telugu, Bengali, Marathi, Gujarati, Kannada,
// Malayalam, Punjabi and Odia, Sarvam's Bulbul models are the only provider
// here that actually speaks the language natively. Sarvam is therefore tried
// FIRST for those languages and LAST for everything else.
// ---------------------------------------------------------------------------

/** Bulbul v3 caps input at 2500 characters. */
const SARVAM_MAX_CHARS = 2500;

/** Documented default voice for bulbul:v3. */
const SARVAM_DEFAULT_SPEAKER = "shubh";

/** Decode the base64 WAV Sarvam returns into raw bytes. */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function speakWithSarvam(
  text: string,
  langTag?: string,
  preferredSpeaker?: string,
  pace?: number,
): Promise<{ audio: ArrayBuffer | null; voice: string }> {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return { audio: null, voice: "browser" };

  // Sarvam only serves eleven languages; skip the request entirely for the
  // rest rather than spending latency on a guaranteed 422.
  const languageCode = getSarvamLanguage(langTag);
  if (!languageCode) return { audio: null, voice: "browser" };

  const clipped = sanitizeForSpeech(text, SARVAM_MAX_CHARS);
  if (!clipped) return { audio: null, voice: "browser" };

  const speaker = (
    preferredSpeaker ??
    process.env.SARVAM_SPEAKER ??
    SARVAM_DEFAULT_SPEAKER
  )
    .trim()
    .toLowerCase();

  try {
    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: clipped,
        language_code: languageCode,
        model: "bulbul:v3",
        speaker,
        output_audio_codec: "wav",
        speech_sample_rate: "24000",
        // Bulbul v3 accepts 0.5–2.0; out-of-range values are rejected.
        ...(typeof pace === "number" && pace >= 0.5 && pace <= 2 ? { pace } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      // Sarvam returns 403 (not 401) for a bad or missing key.
      const errText = await res.text().catch(() => "");
      console.error("Sarvam TTS error", res.status, errText.slice(0, 300));
      return { audio: null, voice: "browser" };
    }

    const data = (await res.json()) as { audios?: string[] };
    const encoded = data.audios?.[0];
    if (!encoded) return { audio: null, voice: "browser" };

    return {
      audio: base64ToArrayBuffer(encoded),
      voice: `sarvam:${languageCode}/${speaker}`,
    };
  } catch (err) {
    console.error("Sarvam TTS failed:", err instanceof Error ? err.message : err);
    return { audio: null, voice: "browser" };
  }
}

/** Groq PlayAI / Orpheus — fast neural English voice. */
async function speakWithGroq(
  text: string,
  requestedVoice?: string,
): Promise<{ audio: ArrayBuffer | null; voice: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { audio: null, voice: "browser" };

  const voice = TTS_VOICES.includes((requestedVoice ?? "") as never)
    ? (requestedVoice as string)
    : TTS_FALLBACK_VOICE;

  // playai-tts was decommissioned by Groq; canopylabs/orpheus-v1-english is
  // the current model (requires one-time org terms acceptance on the key).
  try {
    const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "canopylabs/orpheus-v1-english",
        input: text,
        voice: "tara",
        response_format: "wav",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (errText.includes("model_terms_required")) {
        console.error(
          "Groq TTS needs one-time activation: accept the orpheus-v1-english model terms at console.groq.com (trying the next provider).",
        );
      } else {
        console.error("Groq TTS error", res.status, errText);
      }
      return { audio: null, voice: "browser" };
    }

    return { audio: await res.arrayBuffer(), voice };
  } catch (err) {
    console.error("Groq TTS failed:", err instanceof Error ? err.message : err);
    return { audio: null, voice: "browser" };
  }
}

/**
 * Speak text aloud. TTS chain: Sarvam (Indic) → Groq Orpheus → ElevenLabs →
 * Sarvam (as the general last resort) → the client's browser voice.
 *
 * Returns audio bytes from the first provider that answers, or { audio: null }
 * when none is available — the client then falls back to the browser's speech
 * synthesis, so a provider outage is never a user-facing error.
 */
// ---------------------------------------------------------------------------
// Hume Octave TTS — expressive speech with emotional intelligence.
//
// Octave is a speech-language model, not a formant synthesiser: it reads the
// sentence and decides how it should be delivered (a joke lands differently
// from a warning). The `description` field is acting direction — tone, pacing,
// emphasis — so it is how Jarvis gets *emotion* into the voice rather than just
// audio.
//
// Returns null rather than throwing when unset, so the existing provider chain
// is untouched for anyone without a Hume key.
// ---------------------------------------------------------------------------

/** Languages Octave speaks. Anything outside this is a guaranteed miss. */
const HUME_LANGUAGES = new Set([
  "en", "es", "ja", "ko", "fr", "pt", "it", "de", "ru", "hi", "ar",
]);

/**
 * What Jarvis is feeling while he says it.
 *
 * Derived from the user's own turn rather than invented per reply: a user who
 * sounds frustrated gets a steadier, warmer delivery instead of a chirpy one,
 * which is the whole point of using a model that understands prosody.
 */
const MOOD_DIRECTIONS: Record<string, string> = {
  frustrated: "calm and even-tempered, a little slower, never chirpy",
  angry: "unflappable and measured, noticeably slower",
  sad: "gentle and subdued",
  anxious: "reassuring and unhurried",
  excited: "bright and energetic",
  happy: "warm and upbeat",
  tired: "low-energy and easy on the ears",
  confused: "slow and deliberate, as if explaining carefully",
  curious: "lively and interested",
  stressed: "calm, grounding, unhurried",
};

function octaveDescription(mood?: string | null): string | undefined {
  if (!mood) return undefined;
  return MOOD_DIRECTIONS[mood];
}

async function speakWithHume(
  text: string,
  langTag?: string,
  voice?: string,
  pace?: number,
  mood?: string | null,
): Promise<{ audio: ArrayBuffer | null; voice: string }> {
  const apiKey = process.env.HUME_API_KEY;
  if (!apiKey) return { audio: null, voice: "browser" };

  const language = (langTag ?? "en").split("-")[0].toLowerCase();
  if (!HUME_LANGUAGES.has(language)) return { audio: null, voice: "browser" };

  // The client already chunks replies for playback, so this is a safety net
  // rather than the normal path.
  const clipped = sanitizeForSpeech(text, 1200);
  if (!clipped) return { audio: null, voice: "browser" };

  const utterance: Record<string, unknown> = { text: clipped };

  // A named voice is required for instant mode (the low-latency path live mode
  // depends on). Without one, Octave designs a voice from the acting direction.
  if (voice) {
    utterance.voice = { name: voice };
  } else {
    const description = octaveDescription(mood);
    if (description) utterance.description = description;
  }
  // Outside this range the model can go unstable.
  if (typeof pace === "number" && pace >= 0.75 && pace <= 1.5) {
    utterance.speed = pace;
  }

  try {
    const res = await fetch("https://api.hume.ai/v0/tts", {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        utterances: [utterance],
        format: { type: "mp3" },
        num_generations: 1,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Hume TTS error", res.status, errText.slice(0, 300));
      return { audio: null, voice: "browser" };
    }

    const data = (await res.json()) as {
      generations?: Array<{ audio?: string }>;
    };
    const encoded = data.generations?.[0]?.audio;
    if (!encoded) return { audio: null, voice: "browser" };
    return { audio: base64ToArrayBuffer(encoded), voice: voice ?? "hume" };
  } catch (err) {
    // A TTS outage must never break the turn; the chain moves on.
    console.error("Hume TTS failed", err);
    return { audio: null, voice: "browser" };
  }
}

export const speak = action({
  args: {
    text: v.string(),
    voice: v.optional(v.string()),
    /** BCP-47 tag of the selected region, e.g. "hi-IN". Picks the Sarvam voice. */
    langTag: v.optional(v.string()),
    /** Sarvam speaker name; defaults to the environment, then to "shubh". */
    speaker: v.optional(v.string()),
    /** Speaking rate: 0.5–2.0, where 1 is the model's natural pace. */
    pace: v.optional(v.number()),
    /**
     * Detected mood of the user's turn, e.g. "frustrated". Only used by
     * providers that can act on it (Hume Octave).
     */
    mood: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ audio: ArrayBuffer | null; voice: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use speech output.");

    // Nothing markup-shaped should ever be read aloud (headings, tables,
    // LaTeX, code, URLs) — the providers get prose, not the raw reply.
    const text = sanitizeForSpeech(args.text, 4000);
    if (!text) return { audio: null, voice: "browser" };

    const hume = () =>
      speakWithHume(text, args.langTag, args.voice, args.pace, args.mood);
    const sarvam = () =>
      speakWithSarvam(text, args.langTag, args.speaker, args.pace);
    const groq = () => speakWithGroq(text, args.voice);
    const eleven = () => speakWithElevenLabs(text, args.voice);

    // Indic languages go to Sarvam first — sending Hindi to an English-only
    // model produces accented nonsense. For every other language Sarvam is
    // the final fallback, after the two general-purpose providers.
    //
    // Octave leads when a key is configured: it is the only provider here that
    // understands how a line should be *delivered*, and it covers 11 languages
    // including every Indic one, so it does not displace Sarvam for Hindi.
    const chain = process.env.HUME_API_KEY
      ? isIndicLangTag(args.langTag)
        ? [hume, sarvam, eleven, groq]
        : [hume, groq, eleven, sarvam]
      : isIndicLangTag(args.langTag)
        ? [sarvam, eleven, groq]
        : [groq, eleven, sarvam];

    for (const provider of chain) {
      const result = await provider();
      if (result.audio) return result;
    }

    return { audio: null, voice: "browser" };
  },
});

// ---------------------------------------------------------------------------
// Sound effects — the sounds a language model cannot make.
//
// A text LLM can only answer "what does a dog say?" with the word "woof".
// This action asks ElevenLabs' sound-generation model for the actual audio, so
// Jarvis can genuinely bark, purr, thunder or clang. Generated clips are
// memoised in Convex storage keyed by prompt: a bark costs one generation for
// the lifetime of the deployment, and every repeat is instant and free.
// ---------------------------------------------------------------------------

/** FNV-1a — a short, stable hash used to build cache keys from prompts. */
function hashPrompt(prompt: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const soundEffect = action({
  args: {
    prompt: v.string(),
    duration: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    audio: ArrayBuffer | null;
    cached: boolean;
    prompt: string;
    error: string | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use sound effects.");

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return {
        audio: null,
        cached: false,
        prompt: args.prompt,
        error: "Sound effects need an ELEVENLABS_API_KEY.",
      };
    }

    const prompt = args.prompt.trim().slice(0, 400);
    if (!prompt) {
      return { audio: null, cached: false, prompt: args.prompt, error: "Empty prompt." };
    }

    const promptHash = hashPrompt(prompt);

    // Cache hit: the clip was generated by an earlier request, so this costs
    // a single file read and no generation quota.
    const existing = await ctx.runQuery(internalApi.soundEffects.getByHash, {
      promptHash,
    });
    if (existing) {
      const cached = await ctx.storage.get(existing.storageId);
      if (cached) {
        return {
          audio: await cached.arrayBuffer(),
          cached: true,
          prompt,
          error: null,
        };
      }
    }

    const body: Record<string, unknown> = {
      text: prompt,
      model_id: "eleven_text_to_sound_v2",
    };
    // ElevenLabs requires 0.5–30s; the catalog already picks sane lengths.
    const duration = args.duration;
    if (typeof duration === "number" && duration >= 0.5 && duration <= 30) {
      body.duration_seconds = duration;
    }

    try {
      const res = await fetch(
        "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64",
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(45_000),
        },
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("ElevenLabs sound effect error", res.status, errText.slice(0, 300));
        return {
          audio: null,
          cached: false,
          prompt,
          error:
            res.status === 401 || res.status === 403
              ? "The ElevenLabs key was rejected for sound effects."
              : `Sound generation failed (${res.status}).`,
        };
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0) {
        return { audio: null, cached: false, prompt, error: "Empty audio." };
      }
      const storageId = await ctx.storage.store(
        new Blob([bytes], { type: "audio/mpeg" }),
      );
      await ctx.runMutation(internalApi.soundEffects.save, {
        promptHash,
        prompt,
        storageId,
      });
      return { audio: bytes.buffer, cached: false, prompt, error: null };
    } catch (err) {
      console.error("ElevenLabs sound effect failed:", err instanceof Error ? err.message : err);
      return {
        audio: null,
        cached: false,
        prompt,
        error: "Could not reach the sound generator.",
      };
    }
  },
});
