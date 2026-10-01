import { query } from "./_generated/server";
import { ELEVENLABS_TTS_VOICES, GROQ_TTS_VOICES } from "./voice";

// -------------------------------------------------------------------
// Public client config. Only items that are SAFE to expose in the browser
// (Desmos keys are public client tokens restricted to your registered domain)
// -------------------------------------------------------------------

export const desmosApiKey = query({
  args: {},
  handler: async () => {
    return { apiKey: process.env.DESMOS_API_KEY ?? null };
  },
});

export const getConfig = query({
  args: {},
  handler: async () => {
    return {
      desmos: process.env.DESMOS_API_KEY ?? null,
    };
  },
});

/**
 * Which voices Jarvis can actually speak with, right now.
 *
 * The name lists are imported from `voice.ts` so the picker can never offer a
 * voice the pipeline would reject — the two cannot drift apart, because there
 * is only one list.
 *
 * Availability is reported rather than assumed. A provider with no key is
 * listed but flagged unavailable, which is a different thing from "this voice
 * does not exist" and is worth showing honestly: a picker that hides the
 * ElevenLabs voices until the key appears looks broken, whereas one that greys
 * them out explains itself.
 *
 * This lives here rather than beside the TTS code because `voice.ts` is a
 * `"use node"` module and can export actions only.
 *
 * Reports capability flags only — never key material, and nothing
 * user-specific — so it needs no auth.
 */
export const voiceOptions = query({
  args: {},
  handler: async () => {
    const humeKey = process.env.HUME_API_KEY ?? process.env.HUME_KEY ?? null;
    return {
      providers: [
        {
          id: "groq",
          label: "PlayAI",
          available: Boolean(process.env.GROQ_API_KEY),
          voices: [...GROQ_TTS_VOICES],
        },
        {
          id: "elevenlabs",
          label: "ElevenLabs",
          available: Boolean(process.env.ELEVENLABS_API_KEY),
          voices: [...ELEVENLABS_TTS_VOICES],
        },
        {
          id: "hume",
          label: "Hume Octave",
          available: Boolean(humeKey),
          // Hume names its voices by id rather than by a fixed catalogue, so
          // the default is offered and the provider is left to resolve it.
          voices: ["hume"],
        },
      ],
      paceRange: { min: 0.5, max: 2, default: 1.05 },
    };
  },
});