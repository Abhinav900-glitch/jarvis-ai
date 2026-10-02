import { v } from "convex/values";
import { query } from "./_generated/server";
import { ELEVENLABS_TTS_VOICES, GROQ_TTS_VOICES } from "./voice";
import {
  ENGINES,
  providerStatuses,
  rankEngines,
  type EngineTask,
} from "./engines";

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
/**
 * Which providers are actually usable right now, for the HUD health strip.
 *
 * Key presence only — no key material, nothing user-specific — so it needs no
 * auth. It reads the same registry the router reads, which is the point: a
 * strip that reported health separately could disagree with the engine that
 * really gets called.
 *
 * Each provider also carries the engines it would contribute, so the strip can
 * say what Jarvis is choosing between rather than only whether it is plugged in.
 */
export const providerHealth = query({
  args: {},
  handler: async () => {
    return { providers: providerStatuses() };
  },
});

/**
 * The engine registry as the settings UI needs it: every model, whether it is
 * reachable, and what the router would do with a given kind of turn.
 *
 * `preview` is the interesting part — it lets the picker answer "what would this
 * pick for a maths question?" without sending one.
 */
export const engineOptions = query({
  args: { task: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const task = (
      ["chat", "vision", "reason", "research", "summarize", "title", "live"] as EngineTask[]
    ).includes(args.task as EngineTask)
      ? (args.task as EngineTask)
      : "chat";

    const plan = rankEngines({ task, order: "smart" });
    const byId = new Map(plan.ranked.map((r) => [r.engine.id, r]));

    return {
      engines: ENGINES.map((engine) => {
        const ranked = byId.get(engine.id);
        return {
          id: engine.id,
          label: engine.label,
          provider: engine.provider,
          vision: engine.vision,
          reasoning: engine.reasoning,
          context: engine.context,
          bestFor: engine.bestFor,
          available: ranked?.available ?? false,
          because: ranked?.because ?? engine.bestFor,
          /** 1-based rank for this task, or null when it cannot serve it. */
          rank: ranked ? plan.ranked.filter((r) => r.engine.id === engine.id).length : null,
        };
      }),
      task,
      reason: plan.reason,
    };
  },
});

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