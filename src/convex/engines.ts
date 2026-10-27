// ---------------------------------------------------------------------------
// Smart engine registry.
//
// One table of every model this deployment can actually reach, and the router
// that decides which of them should answer a given turn.
//
// Why this exists: the provider chain used to be a fixed order (Mistral, then
// Groq, then Eden, then HuggingFace), each provider looping through its own
// hand-ordered model list. That list was written when the keyset was first
// verified and never revisited, so a reasoning question and a "what time is it"
// question got the same first attempt, and an image turn got whatever came first
// rather than the only models that can see.
//
// The registry fixes both. Each engine declares what it can do and what it is
// good at, and the router scores the whole set per turn against a task profile —
// so vision turns only ever reach a model that accepts an image, research turns
// prefer a reasoning model, live voice prefers something that answers fast, and
// a very long conversation prefers a big context window.
//
// Availability is read from the environment at call time, never cached: a key
// added in the Keys tab takes effect on the very next message.
//
// This module is deliberately pure — no Convex imports, no side effects — so
// the AI actions (node runtime) and the health/engine queries (Convex runtime)
// can both read it. There is exactly one copy of the model list, so a model
// cannot be routable-but-not-callable or vice versa.
// ---------------------------------------------------------------------------

/** What a turn needs from its engine. Each profile weights the trade-off. */
export type EngineTask =
  | "chat"
  | "vision"
  | "reason"
  | "research"
  | "summarize"
  | "title"
  | "live";

export interface ProviderSpec {
  id: string;
  label: string;
  /** OpenAI-compatible chat completions endpoint. */
  url: string;
  /** Env vars that may hold this provider's key; the first one set wins. */
  keyEnv: string[];
  /** Human-readable "why is this greyed out" for the health strip. */
  missing: string;
  /** Mistral takes `image_url` as a bare string, not `{ url }`. */
  imageUrlAsString: boolean;
  /** Drops image parts entirely, rather than translating them. */
  textOnly: boolean;
  /** Groq-only request knob. */
  reasoningEffort: boolean;
  maxTokens: number;
  timeoutMs: number;
}

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "mistral",
    label: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyEnv: ["MISTRAL_API_KEY", "MISTRAL_KEY"],
    missing: "MISTRAL_API_KEY not configured",
    imageUrlAsString: true,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  {
    id: "groq",
    label: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: ["GROQ_API_KEY"],
    missing: "GROQ_API_KEY not configured",
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: true,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  {
    id: "eden",
    label: "Eden AI",
    url: "https://api.edenai.run/v3/chat/completions",
    keyEnv: ["EDEN_AI_API_KEY", "EDENAI_API_KEY", "EDEN_API_KEY", "EDEN_AI_TOKEN"],
    missing: "EDEN_AI_API_KEY not configured",
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },  {
    id: "huggingface",
    label: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    keyEnv: ["HUGGING_FACE_TOKEN"],
    missing: "HUGGING_FACE_TOKEN not configured",
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 4096,
    timeoutMs: 45_000,
  },
  {
    // One key, dozens of free models, OpenAI-shaped — so it drops into the
    // existing dispatch with no special-casing. `openrouter/free` is a router
    // slug rather than a model: it picks whichever free model currently suits
    // the request, which is why it leads the free block below.
    id: "openrouter",
    label: "OpenRouter (free)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
    missing: "OPENROUTER_API_KEY not configured",
    imageUrlAsString: false,
    // Not text-only: Space Bunny Alpha takes native multimodal input, and the
    // router only sends it an image turn when it picked a vision engine.
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    // Free models sit behind saturated free-tier providers, so a generous
    // deadline is the difference between a slow answer and a fallback.
    timeoutMs: 90_000,
  },
  {
    // Ollama's hosted endpoint: same OpenAI-shaped dispatch as the rest, one
    // key, `Authorization: Bearer` — which is exactly what callProvider
    // already sends. The local runtime needs no key, so this entry covers the
    // cloud; a localhost provider would be a separate entry with its own URL.
    id: "ollama",
    label: "Ollama",
    url: "https://ollama.com/v1/chat/completions",
    keyEnv: ["OLLAMA_API_KEY"],
    missing: "OLLAMA_API_KEY not configured",
    imageUrlAsString: false,
    textOnly: false,
    // Ollama's OpenAI layer accepts the parameter but does not document it
    // per model, so no Groq-only knob is sent here.
    reasoningEffort: false,
    maxTokens: 8192,
    // Hosted open-weight models think before answering, and the first token
    // can take a while on the large ones.
    timeoutMs: 90_000,
  },
];

export interface EngineSpec {
  /** Stable id, `provider/model`, stored on the message for the inspector. */
  id: string;
  provider: string;
  /** The id the provider's API expects. */
  modelId: string;
  label: string;
  /** Accepts `image_url` parts. */
  vision: boolean;
  /** Spends part of its budget thinking before answering. */
  reasoning: boolean;
  /**
   * 0..1 answer quality, scored against the other engines in this table rather
   * than claimed from a public leaderboard — these are free-tier models whose
   * published numbers were measured on other hardware.
   */
  quality: number;
  /** 0..1 responsiveness: higher means less waiting for the first token. */
  speed: number;
  /** Indicative context window, in tokens. */
  context: number;
  /** One clause, shown verbatim in the answer inspector. */
  bestFor: string;
}

/**
 * Availability notes are from live probes against this deployment's own keys,
 * not from vendor docs:
 *  - On Groq, `qwen3.8-27b` is the only vision model; `gpt-oss-120b`/`20b` are
 *    the strong text models.
 *  - On Mistral's free Experiment tier `mistral-large` is not in the
 *    subscription and the small/medium models rate-limit, so the Ministral
 *    family is what actually answers. `ministral-3b` additionally sees images.
 *  - The Eden account reports no balance, so only the two free Gemma models
 *    answer; everything else comes back 402.
 *  - Hugging Face does not serve Qwen2.5-7B-1M or gemma-2-2b-it for this
 *    token, and cannot take an image at all.
 *  - Ollama's hosted roster is live at GET /v1/models and turns over more
 *    often than the rest of this table; the six below were confirmed present
 *    with their vision capability and context length read from /api/tags and
 *    /api/show rather than inferred.
 */
export const ENGINES: EngineSpec[] = [
  // --- Groq ---------------------------------------------------------------
  {
    id: "groq/gpt-oss-120b",
    provider: "groq",
    modelId: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    vision: false,
    reasoning: true,
    quality: 0.94,
    speed: 0.86,
    context: 131_072,
    bestFor: "hard reasoning and long, careful answers",
  },
  {
    id: "groq/qwen3.8-27b",
    provider: "groq",
    modelId: "qwen/qwen3.8-27b",
    label: "Qwen 3.8 27B",
    vision: true,
    reasoning: false,
    quality: 0.86,
    speed: 0.80,
    context: 131_072,
    bestFor: "reading images plus a strong text answer",
  },
  {
    id: "groq/gpt-oss-20b",
    provider: "groq",
    modelId: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    vision: false,
    reasoning: true,
    quality: 0.78,
    speed: 0.93,
    context: 131_072,
    bestFor: "fast reasoning when the answer should not wait",
  },

  // --- Mistral ------------------------------------------------------------
  {
    id: "mistral/ministral-14b",
    provider: "mistral",
    modelId: "ministral-14b-latest",
    label: "Ministral 14B",
    vision: false,
    reasoning: false,
    quality: 0.80,
    speed: 0.60,
    context: 131_072,
    bestFor: "solid everyday prose",
  },
  {
    id: "mistral/mistral-medium",
    provider: "mistral",
    modelId: "mistral-medium-latest",
    label: "Mistral Medium",
    vision: false,
    reasoning: false,
    quality: 0.76,
    speed: 0.70,
    context: 131_072,
    bestFor: "general chat on a fast connection",
  },
  {
    id: "mistral/ministral-8b",
    provider: "mistral",
    modelId: "ministral-8b-latest",
    label: "Ministral 8B",
    vision: false,
    reasoning: false,
    quality: 0.70,
    speed: 0.74,
    context: 65_536,
    bestFor: "quick answers without much cost",
  },
  {
    id: "mistral/ministral-3b",
    provider: "mistral",
    modelId: "ministral-3b-latest",
    label: "Ministral 3B",
    vision: true,
    reasoning: false,
    quality: 0.56,
    speed: 0.90,
    context: 32_768,
    bestFor: "seeing an image when nothing heavier is available",
  },
  {
    id: "mistral/mistral-small",
    provider: "mistral",
    modelId: "mistral-small-latest",
    label: "Mistral Small",
    vision: false,
    reasoning: false,
    quality: 0.50,
    speed: 0.94,
    context: 32_768,
    bestFor: "a very fast, very small reply",
  },

  // --- Eden AI (free tier only) -------------------------------------------
  {
    id: "eden/gemma-4-31b",
    provider: "eden",
    modelId: "google/gemma-4-31b-it",
    label: "Gemma 4 31B",
    vision: true,
    reasoning: true,
    quality: 0.82,
    speed: 0.58,
    context: 131_072,
    bestFor: "reasoning over images, at no cost",
  },
  {
    id: "eden/gemma-4-26b",
    provider: "eden",
    modelId: "google/gemma-4-26b-a4b-it",
    label: "Gemma 4 26B",
    vision: true,
    reasoning: true,
    quality: 0.76,
    speed: 0.68,
    context: 131_072,
    bestFor: "a free second opinion",
  },

  // --- Hugging Face -------------------------------------------------------
  // Declaration order within a provider IS the stable/fallback order, so this
  // block is deliberately cheapest-and-surest first, not best first.
  {
    id: "huggingface/llama-3.1-8b",
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.1-8B-Instruct",
    label: "Llama 3.1 8B",
    vision: false,
    reasoning: false,
    quality: 0.52,
    speed: 0.64,
    context: 131_072,
    bestFor: "the cheapest text answer available",
  },
  {
    id: "huggingface/qwen2.5-72b",
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-72B-Instruct",
    label: "Qwen 2.5 72B",
    vision: false,
    reasoning: false,
    quality: 0.72,
    speed: 0.55,
    context: 131_072,
    bestFor: "a broad second opinion",
  },  {
    id: "huggingface/deepseek-v3",
    provider: "huggingface",
    modelId: "deepseek-ai/DeepSeek-V3-0324",
    label: "DeepSeek V3",
    vision: false,
    reasoning: true,
    quality: 0.79,
    speed: 0.50,
    context: 131_072,
    bestFor: "last-resort reasoning, text only",
  },

  // --- OpenRouter free tier ------------------------------------------------
  // One key reaches all of these, and they cost nothing. Latency and context
  // figures are from a live sweep of the `:free` roster, not from vendor docs.
  //
  // Read this before extending the block: the roster turns over month to month.
  // DeepSeek R1, Qwen3 Coder 480B, Llama 3.3 70B and Llama 4 Scout were all free
  // earlier in 2026 and are not any more. `openrouter/free` is first precisely
  // because it cannot go stale — it re-reads the live roster on every request —
  // so the named models below are fast paths, not the source of truth. The
  // panel's roster view reads GET /v1/models to show what is actually free now.
  //
  // Deliberately excluded, with the reason, so nobody re-adds them blindly:
  //  - poolside/laguna-*      answered with an empty body on most of 7 days.
  //  - thinkingmachines/*     403 unless called from inside their agent tools.
  //  - nvidia/…-content-safety replied off-topic rather than refusing.
  {
    // The best free agentic model available right now: tool calling, 1M
    // context, native multimodal, and ranked #1 by OpenRouter on each of their
    // free / tool-calling / programming collections.
    //
    // Two things to know before relying on it. It is a STEALTH model — an
    // anonymous preview where the author tests a model under a throwaway name —
    // so it is scheduled to be withdrawn (see RETIRING below), and the operator
    // states prompts may be retained by them though not used for training. Do
    // not route secrets or a user's private data through it. It leads because
    // it is the strongest option, not because it is dependable: the free
    // router behind it is what keeps the chain standing when this leaves.
    id: "openrouter/space-bunny",
    provider: "openrouter",
    modelId: "stealth/space-bunny-alpha",
    label: "Space Bunny Alpha",
    vision: true,
    reasoning: false,
    quality: 0.95,
    speed: 0.93,
    context: 1_048_576,
    bestFor: "agentic work — tools, code, 1M context",
  },
  {
    // The self-healing one. It cannot go stale, which is exactly why it sits
    // directly behind a model that is about to.
    id: "openrouter/free",
    provider: "openrouter",
    modelId: "openrouter/free",
    label: "Free Router",
    vision: false,
    reasoning: false,
    quality: 0.80,
    speed: 0.72,
    context: 262_144,
    bestFor: "any task, auto-picking a free model that fits",
  },
  {
    // Next best on OpenRouter's tool-calling and programming collections, 1M
    // context, tools supported. Its free status has rotated before — every
    // DeepSeek model was paid as of July 2026, and `deepseek-v4-flash:free`
    // was confirmed gone from the roster on 2026-10-03. Because it held the
    // top reasoning slot, its disappearance silently demoted the agent off
    // reasoning models entirely. It is replaced below rather than merely
    // dropped, so that slot is filled again.
    //
    // Replacements were picked off the live `:free` roster on 2026-10-03,
    // checking that they are actually there rather than trusting the entry.
    id: "openrouter/ling-flash",
    provider: "openrouter",
    modelId: "inclusionai/ling-3.0-flash-sante:free",
    label: "Ling 3.0 Flash",
    vision: false,
    reasoning: true,
    quality: 0.84,
    speed: 0.78,
    context: 262_144,
    bestFor: "reasoning and long tool chains on a confirmed free slot",
  },
  {
    id: "openrouter/apodex-mini",
    provider: "openrouter",
    modelId: "apodex/apodex-1.1-mini:free",
    label: "Apodex 1.1 Mini",
    vision: false,
    reasoning: false,
    quality: 0.74,
    speed: 0.90,
    context: 262_144,
    bestFor: "the cheap fast step that still has to answer",
  },
  {
    id: "openrouter/nemotron-ultra",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
    label: "Nemotron 3 Ultra",
    vision: false,
    reasoning: false,
    quality: 0.88,
    speed: 0.52,
    context: 1_048_576,
    bestFor: "the strongest free model, and a 1M window",
  },
  {
    id: "openrouter/nemotron-super",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super",
    vision: false,
    reasoning: false,
    quality: 0.78,
    speed: 0.88,
    context: 262_144,
    bestFor: "a fast free answer that still reads carefully",
  },
  {
    id: "openrouter/nemotron-nano",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    label: "Nemotron 3 Nano",
    vision: false,
    reasoning: true,
    quality: 0.72,
    speed: 0.85,
    context: 262_144,
    bestFor: "free reasoning in about a second",
  },
  {
    id: "openrouter/qwen-3-8",
    provider: "openrouter",
    modelId: "qwen/qwen3.8-27b:free",
    label: "Qwen 3.8 27B",
    vision: false,
    reasoning: false,
    quality: 0.80,
    speed: 0.70,
    context: 262_144,
    bestFor: "writing and long structured answers",
  },
  {
    id: "openrouter/north-mini-code",
    provider: "openrouter",
    modelId: "cohere/north-mini-code:free",
    label: "North Mini Code",
    vision: false,
    reasoning: false,
    quality: 0.70,
    speed: 0.95,
    context: 262_144,
    bestFor: "code, in well under a second",
  },
  {
    id: "openrouter/nemotron-lightning",
    provider: "openrouter",
    modelId: "nvidia/nemotron-3.5-lightning:free",
    label: "Nemotron 3.5 Lightning",
    vision: false,
    reasoning: false,
    quality: 0.74,
    speed: 0.45,
    context: 1_048_576,
    bestFor: "a huge window when the prompt itself is enormous",
  },
  {
    id: "openrouter/gemma-4-31b",
    provider: "openrouter",
    modelId: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B",
    vision: false,
    reasoning: false,
    quality: 0.84,
    speed: 0.48,
    context: 262_144,
    bestFor: "free reasoning over a long document",
  },
  {
    id: "openrouter/gemma-4-26b",
    provider: "openrouter",
    modelId: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B",
    vision: false,
    reasoning: true,
    quality: 0.78,
    speed: 0.58,
    context: 262_144,
    bestFor: "a free second opinion on a hard step",
  },
  {
    id: "openrouter/lfm-2-5",
    provider: "openrouter",
    modelId: "liquid/lfm-2.5-2.6b:free",
    label: "LFM2.5 2.6B",
    vision: false,
    reasoning: false,
    quality: 0.42,
    speed: 0.96,
    context: 65_536,
    bestFor: "the cheapest step that still has to run",
  },

  // --- Ollama (hosted) -----------------------------------------------------
  // The roster was read live from GET /v1/models, and each model's vision
  // capability from GET /api/tags (`capabilities` includes "vision") and its
  // window from GET /api/show (`model_info.*.context_length`). So `vision` and
  // `context` below are measured facts, not guesses from the model's family.
  //
  // Six of the twenty-three hosted models: one of each shape the router asks
  // for — a heavy reasoner, a long-window reader, two fast vision models, a
  // prose model and a compact one. The rest can be added the same way.
  //
  // Declared surest-first: within a provider, declaration order is the
  // fallback ladder when the router is switched off.
  {
    id: "ollama/glm-5.3-flash",
    provider: "ollama",
    modelId: "glm-5.3-flash",
    label: "GLM 5.3 Flash",
    vision: true,
    reasoning: true,
    quality: 0.80,
    speed: 0.88,
    context: 1_048_576,
    bestFor: "a quick everyday reply that can still see images",
  },
  {
    id: "ollama/deepseek-v4.1-flash",
    provider: "ollama",
    modelId: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    vision: true,
    reasoning: true,
    quality: 0.84,
    speed: 0.86,
    context: 1_048_576,
    bestFor: "fast current answers, images included",
  },
  {
    id: "ollama/gemma4-31b",
    provider: "ollama",
    modelId: "gemma4:31b",
    label: "Gemma 4 31B",
    vision: true,
    reasoning: true,
    quality: 0.76,
    speed: 0.80,
    context: 262_144,
    bestFor: "a compact vision model for lighter turns",
  },
  {
    id: "ollama/mistral-large-4",
    provider: "ollama",
    modelId: "mistral-large-4",
    label: "Mistral Large 4",
    vision: true,
    reasoning: true,
    quality: 0.87,
    speed: 0.68,
    context: 1_048_576,
    bestFor: "multilingual prose over a very long document",
  },
  {
    id: "ollama/kimi-k3",
    provider: "ollama",
    modelId: "kimi-k3",
    label: "Kimi K3",
    vision: true,
    reasoning: true,
    quality: 0.90,
    speed: 0.64,
    context: 1_048_576,
    bestFor: "a million tokens of context, thinking as it goes",
  },
  {
    id: "ollama/gpt-oss-120b",
    provider: "ollama",
    modelId: "gpt-oss:120b",
    label: "GPT-OSS 120B",
    vision: false,
    reasoning: true,
    quality: 0.92,
    speed: 0.70,
    context: 131_072,
    bestFor: "hard reasoning from a large open model",
  },
];

/**
 * Engines with a published end-of-life date, as `engineId → the day it goes`.
 *
 * A stealth model is a name an author borrows to test something in public, so
 * it is withdrawn by design. Recording the date here means the UI can say
 * "retires in 3 days" while that is still true and still actionable, instead of
 * the engine quietly 404ing on a day nobody was watching and burning a request
 * from a 50-a-day budget on every step to find out.
 *
 * A date that has passed is not an error, and does not need this table to be
 * tidied up on the day: `isRetired` drops the engine from routing from that
 * moment on, and the provider chain would fall through anyway. The entry can
 * stay here as a record of what was withdrawn. A date still ahead of us is the
 * useful state, because it is the one the panel can warn about.
 */
export const RETIRING: Record<string, string> = {
  "openrouter/space-bunny": "2026-10-05",
};

/** Engine ids whose withdrawal is still in the future. */
export function retiringSoon(): { id: string; label: string; on: string }[] {
  const now = Date.now();
  return Object.entries(RETIRING)
    .filter(([, on]) => Date.parse(on) > now)
    .map(([id, on]) => ({
      id,
      label: engineById(id)?.label ?? id,
      on,
    }));
}

/**
 * Whether an engine's published withdrawal date has already passed.
 *
 * Enforced in routing, not just reported. A withdrawn model does not announce
 * itself: the provider answers with an error, the chain falls through, and the
 * step still completes — but it spends one request from a 50-a-day free budget
 * to discover something the registry already knew. Dropping it from the plan up
 * front costs nothing and keeps the routing honest about which engine will run.
 *
 * The date is read as UTC midnight, so the engine leaves the plan at the start
 * of its withdrawal day rather than at some arbitrary hour of it.
 */
export function isRetired(id: string, now: number = Date.now()): boolean {
  const on = RETIRING[id];
  return on !== undefined && Date.parse(on) <= now;
}

/**
 * Position in the always-safe fallback ladder: provider order, then the order
 * models are declared within it. Used when the router is switched off, so
 * "off" means the old fixed behaviour rather than a different new one.
 */
const STABLE_RANK = new Map(
  ENGINES.map((engine, index) => {
    const providerIndex = PROVIDERS.findIndex((p) => p.id === engine.provider);
    return [engine.id, providerIndex * 100 + index] as const;
  }),
);

const BY_ID = new Map(ENGINES.map((e) => [e.id, e]));
const PROVIDER_BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

export function engineById(id: string | null | undefined): EngineSpec | null {
  return id ? BY_ID.get(id) ?? null : null;
}

export function providerById(id: string): ProviderSpec | null {
  return PROVIDER_BY_ID.get(id) ?? null;
}

/** First non-empty key among this provider's accepted env names. */
export function providerKey(provider: ProviderSpec): string | null {
  for (const name of provider.keyEnv) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export interface ProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Why it is unavailable, or "" when it is fine. */
  note: string;
  /** Engines this provider would contribute, best first. */
  engines: { id: string; label: string; available: boolean }[];
}

/** Key-presence only. Never returns any key material. */
export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((provider) => {
    const engines = ENGINES.filter((e) => e.provider === provider.id)
      .sort((a, b) => b.quality - a.quality)
      // A retired engine is reported unavailable even when its key is present,
      // so the health surface stops advertising a model the router will refuse.
      .map((e) => ({ id: e.id, label: e.label, available: !isRetired(e.id) }));
    const configured = Boolean(providerKey(provider));
    return {
      id: provider.id,
      label: provider.label,
      configured,
      note: configured ? "" : provider.missing,
      engines: configured ? engines : engines.map((e) => ({ ...e, available: false })),
    };
  });
}

/**
 * How each task trades quality against speed.
 *
 * `reasoning` is a bonus only given to engines that actually reason, on the
 * tasks where thinking helps — asking a reasoning model to name a time zone
 * just makes it slower for nothing.
 */
const WEIGHTS: Record<EngineTask, { quality: number; speed: number; reasoning: number }> = {
  chat: { quality: 0.72, speed: 0.28, reasoning: 0 },
  vision: { quality: 0.85, speed: 0.15, reasoning: 0 },
  reason: { quality: 0.58, speed: 0.12, reasoning: 0.3 },
  research: { quality: 0.6, speed: 0.1, reasoning: 0.3 },
  summarize: { quality: 0.58, speed: 0.42, reasoning: 0 },
  title: { quality: 0.3, speed: 0.7, reasoning: 0 },
  live: { quality: 0.38, speed: 0.62, reasoning: 0 },
};

export interface RankedEngine {
  engine: EngineSpec;
  score: number;
  /** True when every env var this engine needs is present. */
  available: boolean;
  /** Why it landed here, in one short clause. */
  because: string;
}

export interface EnginePlan {
  /** Everything, best first, unconfigured engines pushed to the end. */
  ranked: RankedEngine[];
  /** Just the reachable ones. This is the order the chain walks. */
  usable: RankedEngine[];
  /** One sentence, stored on the message and shown in the inspector. */
  reason: string;
  /** The engine the router picked, or null when nothing is configured. */
  primary: RankedEngine | null;
}

export interface RouteRequest {
  task?: EngineTask;
  /** Turns carrying an image can only reach a model that accepts one. */
  hasImages?: boolean;
  /** Roughly how long the prompt is, used for the context-window bonus. */
  promptChars?: number;
  /** The engine the user pinned. When it can serve the turn, it wins. */
  preferEngineId?: string | null;
  /** Skipped entirely — used to find a genuinely different second opinion. */
  excludeEngineId?: string | null;
  /**
   * "stable" (the default) walks the fixed provider ladder and ignores the
   * scores entirely; "smart" routes per turn. Callers pass "smart" only when
   * the user has the router switched on.
   */
  order?: "smart" | "stable";
}

/** Above this many characters, a big context window starts to matter. */
const LONG_PROMPT_CHARS = 8_000;

export function rankEngines(request: RouteRequest = {}): EnginePlan {
  const task: EngineTask = request.task ?? (request.hasImages ? "vision" : "chat");
  const weights = WEIGHTS[task];
  const smart = (request.order ?? "stable") === "smart";
  const excluded = request.excludeEngineId ?? null;
  const preferred = request.preferEngineId ?? null;
  const wantImages = Boolean(request.hasImages);

  const scored: RankedEngine[] = [];
  for (const engine of ENGINES) {
    if (excluded && engine.id === excluded) continue;
    // A withdrawn engine is dropped from the plan outright, including when it
    // is pinned: it cannot serve the turn, so honouring the pin would only
    // fail one request later instead of now. This is the one place a date in
    // RETIRING actually changes behaviour — everywhere else it is a label.
    if (isRetired(engine.id)) continue;
    // Capability, not preference: a text-only model cannot be told to look at
    // a picture, so it is dropped rather than ranked last.
    if (wantImages && !engine.vision) continue;

    const provider = providerById(engine.provider);
    const available = provider ? Boolean(providerKey(provider)) : false;

    let score = smart
      ? engine.quality * weights.quality +
        engine.speed * weights.speed +
        (engine.reasoning ? weights.reasoning : 0)
      : 0;

    if (request.promptChars && request.promptChars > LONG_PROMPT_CHARS) {
      score += 0.1 * Math.min(1, engine.context / 131_072);
    }

    // A user-pinned engine is honoured whenever it can serve the turn at all.
    if (preferred && engine.id === preferred) score += 10;
    if (!smart) {
      // Stable mode ignores the scores entirely, so the pin is expressed by
      // the sort rather than by a number nothing reads.
      scored.push({
        engine,
        score: 0,
        available,
        because:
          preferred && engine.id === preferred
            ? "pinned in settings"
            : "stable provider order",
      });
      continue;
    }

    const reasons: string[] = [engine.bestFor];
    if (weights.reasoning > 0 && engine.reasoning) reasons.push("reasons before answering");
    if (weights.speed >= 0.5 && engine.speed >= 0.85) reasons.push("answers fast");
    if (
      request.promptChars &&
      request.promptChars > LONG_PROMPT_CHARS &&
      engine.context >= 131_072
    ) {
      reasons.push("long context");
    }

    scored.push({
      engine,
      score,
      available,
      because: reasons.slice(0, 2).join(", "),
    });
  }

  const stableRankOf = (entry: RankedEngine) =>
    preferred && entry.engine.id === preferred
      ? -1
      : (STABLE_RANK.get(entry.engine.id) ?? 999);

  scored.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (smart) return b.score - a.score;
    return stableRankOf(a) - stableRankOf(b);
  });

  const usable = scored.filter((e) => e.available);
  const primary = usable[0] ?? null;

  return {
    ranked: scored,
    usable,
    primary,
    reason: primary
      ? `${primary.engine.label} — ${primary.because}`
      : "No AI provider is configured for this deployment.",
  };
}

/**
 * Guess what a turn needs before any routing happens.
 *
 * Cheap keyword classification, deliberately: the goal is to stop a maths or
 * research question being answered by whatever model happens to be first, not
 * to classify language perfectly.
 */
export function inferTask(text: string, hasImages: boolean): EngineTask {
  if (hasImages) return "vision";

  const lower = text.toLowerCase();
  const reason =
    /\b(solve|derive|proof|integral|derivative|differentiate|equation|matrix|determinant|regression|probability|algorithm|complexity|optimi[sz]e|debug|why does|step[- ]by[- ]step|calculate|simplify|factori[sz]e)\b/.test(
      lower,
    );
  if (reason) return "reason";

  const research =
    /\b(research|investigate|find out|compare|latest|news|what happened|state of|market|history of|why (is|are|do|does|did))\b/.test(
      lower,
    );
  if (research) return "research";

  return "chat";
}