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
  | "code"
  | "translate"
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
  /**
   * Model plugins this provider ships: installed and visible in the plugin
   * list, but an entry with `enabled: false` is not routed in chat until the
   * user switches it on. Empty for every provider that ships none.
   */
  plugins: PluginEntry[];
}

/**
 * A model a provider offers as an installable plugin rather than as an
 * always-on engine: present in the list, absent from chat until switched on.
 * `slug` matches the gated engine's `modelId`.
 */
export interface PluginEntry {
  /** The gated engine's `modelId`, e.g. `muse-light-1.0`. */
  slug: string;
  /** Short human title shown in the plugin list. */
  title: string;
  /** One line explaining when it is worth switching on. */
  when: string;
  /** Shipped state — `false` means installed but not used in chat. */
  enabled: boolean;
}

/** Helper that every provider entry is expected to set. */
const HTTP_PROVIDER: ProviderSpec["plugins"] = [];

/** The free Meta Model API engines, shipped as plugins: installed so they
 * show up in the list, but off by default so the router never reaches them
 * until the user opts in. A pinned engine still wins over the gate.
 */
export const FREE_META_MODELS: PluginEntry[] = [
  {
    slug: "muse-light-1.0",
    title: "Muse Light 1.0",
    when: "Fast answers at no cost — a cheap first step before a heavier model.",
    enabled: false,
  },
  {
    slug: "muse-small-1.0",
    title: "Muse Small 1.0",
    when: "Solid everyday tasks without a token bill.",
    enabled: false,
  },
];

export const PROVIDERS: ProviderSpec[] = [
  {
    id: "mistral",
    label: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyEnv: ["MISTRAL_API_KEY", "MISTRAL_KEY"],
    missing: "MISTRAL_API_KEY not configured",
    plugins: HTTP_PROVIDER,
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
    plugins: HTTP_PROVIDER,
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
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    url: "https://router.huggingface.co/v1/chat/completions",
    keyEnv: ["HUGGING_FACE_TOKEN"],
    missing: "HUGGING_FACE_TOKEN not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 4096,
    timeoutMs: 45_000,
  },
  {
    id: "openrouter",
    label: "OpenRouter (free)",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
    missing: "OPENROUTER_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  {
    id: "ollama",
    label: "Ollama",
    url: "https://ollama.com/v1/chat/completions",
    keyEnv: ["OLLAMA_API_KEY"],
    missing: "OLLAMA_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  {
    id: "googleai",
    label: "Gemini (AI Studio)",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
    missing: "GEMINI_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    keyEnv: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NGC_API_KEY"],
    missing: "NVIDIA_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  {
    id: "meta",
    label: "Meta (Muse)",
    url: "https://api.meta.ai/v1/chat/completions",
    keyEnv: ["MODEL_API_KEY", "META_AI_API_KEY", "META_API_KEY"],
    missing: "MODEL_API_KEY not configured",
    plugins: FREE_META_MODELS,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  {
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    url: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/chat/completions",
    keyEnv: ["CLOUDFARE_WORKERS_API_KEY", "CLOUDFLARE_WORKERS_API_TOKEN", "CLOUDFLARE_API_TOKEN"],
    missing: "CLOUDFARE_WORKERS_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  // Cohere's compatibility surface, not its native `/v2/chat`: the engine
  // registry speaks OpenAI chat completions to every provider so there is one
  // request builder and one response parser, and Cohere publishes an endpoint
  // that accepts exactly that shape. Probed live on 2026-11-16 — a real
  // completion per registered model, not just a catalogue listing.
  {
    id: "cohere",
    label: "Cohere",
    url: "https://api.cohere.ai/compatibility/v1/chat/completions",
    keyEnv: ["COHERE_AI_API_KEY", "COHERE_API_KEY"],
    missing: "COHERE_AI_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    // Proven on 2026-11-16: Cohere's compatibility endpoint takes
    // `image_url: { url }` and rejects a bare string, which is exactly the
    // shape every other provider in this table uses — so no special case.
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 60_000,
  },
  // A Gonka broker gateway. Brokers resell network inference behind an
  // OpenAI-compatible endpoint; this is the key's broker
  // (proxy.gonkabroker.com), whose `/v1/models` is the only roster that matters
  // for it — another broker would differ. Text only: none of the models this
  // key serves take images.
  {
    id: "gonka",
    label: "Gonka (broker)",
    url: "https://proxy.gonkabroker.com/v1/chat/completions",
    keyEnv: ["GONKA_BROKER_API_KEY", "GONKA_API_KEY"],
    missing: "GONKA_BROKER_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  // Aion Labs — OpenAI-compatible, bearer key, text only. Its models are a
  // GLM-based multi-model system (3.0/3.5) and DeepSeek variants (2.0/3.0 Mini),
  // with a dedicated roleplay fine-tune. No `reasoning_effort` knob is sent:
  // the catalogue advertises it per model, and sending it to the RP model is
  // rejected, so the reasoning models are allowed to think on their own.
  {
    id: "aionlabs",
    label: "Aion Labs",
    url: "https://api.aionlabs.ai/v1/chat/completions",
    keyEnv: ["AION_LABS_API_KEY", "AION_API_KEY"],
    missing: "AION_LABS_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  // Requesty — one OpenAI-compatible router in front of ~800 models. The
  // endpoint and the catalogue are public; only the completion path needs the
  // key, which is why the engines below are a short list of ids probed with a
  // real answer rather than everything the catalogue advertises. Model ids are
  // namespaced by lab (`google/…`, `openai/…`), and the router accepts them
  // verbatim, so the engine ids here stay short while `modelId` is exact.
  {
    id: "requesty",
    label: "Requesty",
    url: "https://router.requesty.ai/v1/chat/completions",
    keyEnv: ["REQUESTY_API_KEY", "REQUESTY_KEY"],
    missing: "REQUESTY_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: false,
    reasoningEffort: false,
    maxTokens: 8192,
    timeoutMs: 90_000,
  },
  // Public AI — a non-profit gateway to open-weight models, mostly European and
  // Southeast Asian. `/v1/models` is key-gated (401 without a header), so the
  // catalogue is a genuine check that the key is accepted; the engines below
  // were each answered with a real completion on 2026-11-19. Text only: every
  // model in this catalogue is text-in, so image parts are dropped rather than
  // sent to be rejected.
  {
    id: "publicai",
    label: "Public AI",
    url: "https://api.publicai.co/v1/chat/completions",
    keyEnv: ["PUBLIC_AI_API_KEY", "PUBLICAI_API_KEY"],
    missing: "PUBLIC_AI_API_KEY not configured",
    plugins: HTTP_PROVIDER,
    imageUrlAsString: false,
    textOnly: true,
    reasoningEffort: false,
    maxTokens: 4096,
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
 *    often than the rest of this table. Of its 23 models only 7 are covered by
 *    the free allowance — the rest answer 402 "not included in your free
 *    usage" — so every Ollama engine below was probed with a real completion
 *    on 2026-10-27 rather than read off the roster.
 */
export const ENGINES: EngineSpec[] = [
  // --- Cloudflare Workers AI ----------------------------------------------
  // Registered from a live probe on 2026-11-08, not from the catalogue: this
  // account has its own per-model allowlist. `llama-3.1-8b` answered 410
  // (deprecated) and `gemma-3-12b` answered 403 (not allowed on this account),
  // so neither is registered. A provider in PROVIDERS with no engines is
  // unreachable — the ladder can never pick it and the fallback test fails.
  {
    id: "cloudflare/gpt-oss-120b",
    provider: "cloudflare",
    modelId: "@cf/openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    vision: false,
    reasoning: true,
    quality: 0.9,
    speed: 0.78,
    context: 128_000,
    bestFor: "strong reasoning on the free daily allowance",
  },
  {
    id: "cloudflare/llama-3.3-70b",
    provider: "cloudflare",
    modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    label: "Llama 3.3 70B",
    vision: false,
    reasoning: false,
    quality: 0.84,
    speed: 0.9,
    context: 24_000,
    bestFor: "fast, dependable answers at no cost",
  },
  {
    id: "cloudflare/qwq-32b",
    provider: "cloudflare",
    modelId: "@cf/qwen/qwq-32b",
    label: "QwQ 32B",
    vision: false,
    reasoning: true,
    quality: 0.82,
    speed: 0.72,
    context: 24_000,
    bestFor: "step-by-step maths and logic",
  },
  {
    id: "cloudflare/gpt-oss-20b",
    provider: "cloudflare",
    modelId: "@cf/openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    vision: false,
    reasoning: false,
    quality: 0.74,
    speed: 0.95,
    context: 128_000,
    bestFor: "quick replies that cost nothing",
  },
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
  },
  {
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
  {
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
    label: "Nemotron 3 Nano Omni",
    // "Omni" is the capability: this one takes image, audio and video parts,
    // which is why it is the free model a screenshot can be sent to.
    vision: true,
    reasoning: true,
    quality: 0.72,
    speed: 0.85,
    context: 262_144,
    bestFor: "free reasoning in about a second, images included",
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
  {
    id: "openrouter/lfm-3-1-7b",
    provider: "openrouter",
    modelId: "liquid/lfm-3-1.7b:free",
    label: "LFM3 1.7B",
    vision: false,
    // The free route always thinks before it answers, so it is flagged as a
    // reasoning model; its 1.7B size is what keeps it out of the hard slots.
    reasoning: true,
    quality: 0.50,
    speed: 0.94,
    context: 262_144,
    // A 1.7B model earns its place on speed alone: short classification and
    // one-line rewrites, where a large model's extra seconds buy nothing.
    // Liquid advises against agentic coding on the LFM line, so code stays off
    // the list even though this one is fast enough for it.
    bestFor: "the shortest steps — one line in, one line out",
  },
  {
    id: "openrouter/flint",
    provider: "openrouter",
    modelId: "recursive/flint-v1.0:free",
    label: "Flint",
    vision: false,
    reasoning: true,
    quality: 0.78,
    speed: 0.80,
    context: 262_144,
    bestFor: "reading code and tests on a free slot",
  },

  // `parallel/decisions-fast:free` is deliberately not in this list. It is a
  // Decisions endpoint, not a chat model: it accepts a `state` plus typed
  // questions and answers with probabilities and citations, and OpenRouter's
  // docs say chat-completions clients cannot call it. Registered here it would
  // post to /chat/completions and fail on every request.

  // --- Ollama (hosted) -----------------------------------------------------
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
  {
    id: "ollama/nemotron-3-ultra",
    provider: "ollama",
    modelId: "nemotron-3-ultra",
    label: "Nemotron 3 Ultra",
    vision: false,
    reasoning: true,
    quality: 0.88,
    speed: 0.60,
    context: 262_144,
    bestFor: "the strongest free Ollama model with a 256k window",
  },
  {
    id: "ollama/beam",
    provider: "ollama",
    modelId: "beam",
    label: "Beam",
    vision: false,
    reasoning: true,
    quality: 0.82,
    speed: 0.66,
    context: 1_048_576,
    bestFor: "a million tokens when the prompt itself is enormous",
  },
  {
    id: "ollama/nemotron-3-super",
    provider: "ollama",
    modelId: "nemotron-3-super",
    label: "Nemotron 3 Super",
    vision: false,
    reasoning: true,
    quality: 0.80,
    speed: 0.78,
    context: 262_144,
    bestFor: "a balanced free answer that still reads carefully",
  },
  {
    id: "ollama/gemma4-31b",
    provider: "ollama",
    modelId: "gemma4:31b",
    label: "Gemma 4 31B",
    vision: true,
    reasoning: true,
    quality: 0.78,
    speed: 0.80,
    context: 262_144,
    bestFor: "the one free Ollama model that can see images",
  },
  {
    id: "ollama/gpt-oss-20b",
    provider: "ollama",
    modelId: "gpt-oss:20b",
    label: "GPT-OSS 20B",
    vision: false,
    reasoning: true,
    quality: 0.76,
    speed: 0.86,
    context: 131_072,
    bestFor: "fast reasoning when the answer should not wait",
  },
  {
    id: "ollama/nemotron-3-nano",
    provider: "ollama",
    modelId: "nemotron-3-nano:30b",
    label: "Nemotron 3 Nano",
    vision: false,
    reasoning: true,
    quality: 0.70,
    speed: 0.90,
    context: 262_144,
    bestFor: "the lightest free step that still thinks before answering",
  },

  // --- Google AI Studio (Gemini free tier) --------------------------------
  {
    id: "googleai/gemini-3.6-flash",
    provider: "googleai",
    modelId: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    vision: true,
    reasoning: true,
    quality: 0.88,
    speed: 0.72,
    context: 1_048_576,
    bestFor: "the surest Gemini choice — balanced multimodal reasoning",
  },
  {
    id: "googleai/gemini-3.5-flash",
    provider: "googleai",
    modelId: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    vision: true,
    reasoning: true,
    quality: 0.85,
    speed: 0.95,
    context: 1_048_576,
    bestFor: "fast multimodal chat — 1.1s measured, image turn accepted",
  },
  {
    id: "googleai/gemini-3-flash-preview",
    provider: "googleai",
    modelId: "gemini-3-flash-preview",
    label: "Gemini 3 Flash",
    vision: true,
    reasoning: true,
    quality: 0.83,
    speed: 0.7,
    context: 1_048_576,
    bestFor: "frontier-class reasoning on the free tier",
  },
  {
    id: "googleai/gemini-3.1-flash-lite",
    provider: "googleai",
    modelId: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    vision: true,
    reasoning: false,
    quality: 0.81,
    speed: 0.68,
    context: 1_048_576,
    bestFor: "a near-frontier answer when speed matters",
  },
  {
    id: "googleai/gemini-3.5-flash-lite",
    provider: "googleai",
    modelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    vision: true,
    reasoning: false,
    quality: 0.78,
    speed: 0.9,
    context: 1_048_576,
    bestFor: "titles, summaries and other high-volume steps",
  },
  // --- Meta (Muse) -------------------------------------------------------
  {
    id: "meta/muse-spark-1.3",
    provider: "meta",
    modelId: "muse-spark-1.3",
    label: "Muse Spark 1.3",
    vision: true,
    reasoning: true,
    quality: 0.93,
    speed: 0.72,
    context: 1_048_576,
    bestFor: "long-context reasoning across a million-token window",
  },
  {
    id: "meta/muse-wonder-1.0",
    provider: "meta",
    modelId: "muse-wonder-1.0",
    label: "Muse Wonder 1.0",
    vision: true,
    reasoning: true,
    quality: 0.96,
    speed: 0.58,
    context: 1_048_576,
    bestFor: "complex multi-step coding and long-horizon tasks",
  },

  // --- Meta (Muse), free tier — installed as plugins, off in chat --------
  {
    id: "meta/muse-light-1.0",
    provider: "meta",
    modelId: "muse-light-1.0",
    label: "Muse Light 1.0",
    vision: false,
    reasoning: false,
    quality: 0.72,
    speed: 0.88,
    context: 131_072,
    bestFor: "a free Meta answer once the plugin is switched on",
  },
  {
    id: "meta/muse-small-1.0",
    provider: "meta",
    modelId: "muse-small-1.0",
    label: "Muse Small 1.0",
    vision: false,
    reasoning: false,
    quality: 0.66,
    speed: 0.92,
    context: 65_536,
    bestFor: "solid everyday tasks at no cost, once enabled",
  },

  // --- NVIDIA NIM ---------------------------------------------------------
  {
    id: "nvidia/nemotron-3.5-lightning",
    provider: "nvidia",
    modelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    label: "Nemotron 3.5 Lightning (NIM)",
    vision: false,
    reasoning: false,
    quality: 0.80,
    speed: 0.86,
    context: 1_048_576,
    bestFor: "a fast general answer on the NIM catalogue",
  },
  {
    id: "nvidia/nemotron-3.5-super-vl",
    provider: "nvidia",
    modelId: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    label: "Nemotron 3.5 Super VL (NIM)",
    vision: true,
    reasoning: true,
    quality: 0.86,
    speed: 0.62,
    context: 262_144,
    bestFor: "reading an image, and the strongest chat on NIM",
  },
  {
    id: "nvidia/llama-3.2-90b-vision",
    provider: "nvidia",
    modelId: "meta/llama-3.2-90b-vision-instruct",
    label: "Llama 3.2 90B Vision (NIM)",
    vision: true,
    reasoning: false,
    quality: 0.82,
    speed: 0.66,
    context: 131_072,
    bestFor: "reading an image on the NIM catalogue",
  },

  // --- Cohere (compatibility endpoint) ------------------------------------
  // Registered from a live probe on 2026-11-16: `/v1/models` for the context
  // windows, then one real completion per model for availability and latency.
  // The two vision models were proven separately by sending a solid crimson
  // 16x16 PNG in the app's own `image_url: { url }` shape: both answered "Red"
  // in under half a second, so they are registered as vision engines.
  {
    id: "cohere/command-a-plus",
    provider: "cohere",
    modelId: "command-a-plus-05-2026",
    label: "Command A Plus",
    vision: false,
    reasoning: false,
    quality: 0.88,
    speed: 0.78,
    context: 436_000,
    bestFor: "long documents and tool use on Cohere's newest flagship",
  },
  {
    id: "cohere/command-a",
    provider: "cohere",
    modelId: "command-a-03-2025",
    label: "Command A",
    vision: false,
    reasoning: false,
    quality: 0.86,
    speed: 0.86,
    context: 288_000,
    bestFor: "fast grounded answers with citations",
  },
  {
    id: "cohere/command-a-reasoning",
    provider: "cohere",
    modelId: "command-a-reasoning-08-2025",
    label: "Command A Reasoning",
    vision: false,
    reasoning: true,
    quality: 0.87,
    speed: 0.62,
    context: 288_768,
    bestFor: "step-by-step reasoning and multi-part problems",
  },
  {
    id: "cohere/command-a-translate",
    provider: "cohere",
    modelId: "command-a-translate-08-2025",
    label: "Command A Translate",
    vision: false,
    reasoning: false,
    // A translation specialist with a small window: excellent at its job,
    // and the router must not hand it a long document to read first.
    quality: 0.82,
    speed: 0.86,
    context: 8_992,
    bestFor: "translation between languages",
  },
  {
    id: "cohere/command-r-plus",
    provider: "cohere",
    modelId: "command-r-plus-08-2024",
    label: "Command R+",
    vision: false,
    reasoning: false,
    quality: 0.78,
    speed: 0.74,
    context: 128_000,
    bestFor: "retrieval-heavy answers over supplied documents",
  },
  {
    id: "cohere/command-r",
    provider: "cohere",
    modelId: "command-r-08-2024",
    label: "Command R",
    vision: false,
    reasoning: false,
    quality: 0.72,
    speed: 0.5,
    context: 128_000,
    bestFor: "grounded answers when the fast models are throttled",
  },
  {
    id: "cohere/command-r7b",
    provider: "cohere",
    modelId: "command-r7b-12-2024",
    label: "Command R7B",
    vision: false,
    reasoning: false,
    quality: 0.6,
    speed: 0.94,
    context: 132_000,
    bestFor: "a quick, cheap reply",
  },
  {
    id: "cohere/command-a-vision",
    provider: "cohere",
    modelId: "command-a-vision-07-2025",
    label: "Command A Vision",
    vision: true,
    reasoning: false,
    quality: 0.84,
    speed: 0.9,
    context: 128_000,
    bestFor: "reading an image and answering about it quickly",
  },
  {
    id: "cohere/aya-vision-32b",
    provider: "cohere",
    modelId: "c4ai-aya-vision-32b",
    label: "Aya Vision 32B",
    vision: true,
    reasoning: false,
    quality: 0.72,
    speed: 0.9,
    // A 16k window: enough for an image plus a question, not for a long
    // document with pictures in it.
    context: 16_384,
    bestFor: "image questions in 23 languages",
  },
  {
    id: "cohere/aya-expanse-32b",
    provider: "cohere",
    modelId: "c4ai-aya-expanse-32b",
    label: "Aya Expanse 32B",
    vision: false,
    reasoning: false,
    quality: 0.75,
    speed: 0.8,
    context: 128_000,
    bestFor: "multilingual answers across 23 languages",
  },

  // --- Gonka (broker gateway) ---------------------------------------------
  // Two of the three text models this key serves are registered. `zai-org/GLM-5.3-Flash`
  // answered 200 but returned no content within 200 tokens (it spends them
  // thinking), so it is not registered until a real visible answer is seen.
  {
    id: "gonka/minimax-m2.7",
    provider: "gonka",
    modelId: "MiniMaxAI/MiniMax-M2.7",
    label: "MiniMax M2.7",
    vision: false,
    reasoning: true,
    quality: 0.86,
    speed: 0.7,
    context: 204_800,
    bestFor: "long-context reasoning from MiniMax",
  },
  {
    id: "gonka/deepseek-v4-flash",
    provider: "gonka",
    modelId: "deepseek-ai/DeepSeek-V4-Flash-0731",
    label: "DeepSeek V4 Flash",
    vision: false,
    reasoning: false,
    quality: 0.83,
    speed: 0.82,
    context: 400_000,
    bestFor: "a fast answer over a very long prompt",
  },

  // --- Aion Labs -----------------------------------------------------------
  // Roster read from the provider's own `/v1/models`, which is public. Only the
  // ids it lists are registered: inventing a plausible model name is how a
  // provider's whole account gets marked exhausted by a 400.
  {
    id: "aionlabs/aion-3.5",
    provider: "aionlabs",
    modelId: "aion-labs/aion-3.5",
    label: "Aion 3.5",
    vision: false,
    reasoning: true,
    quality: 0.92,
    speed: 0.68,
    context: 262_144,
    bestFor: "a long, carefully argued answer",
  },
  {
    id: "aionlabs/aion-3.5-mini",
    provider: "aionlabs",
    modelId: "aion-labs/aion-3.5-mini",
    label: "Aion 3.5 Mini",
    vision: false,
    reasoning: true,
    quality: 0.81,
    speed: 0.86,
    context: 262_144,
    bestFor: "a quick answer over a 262k-token prompt",
  },
  {
    id: "aionlabs/aion-3.0",
    provider: "aionlabs",
    modelId: "aion-labs/aion-3.0",
    label: "Aion 3.0",
    vision: false,
    reasoning: true,
    quality: 0.88,
    speed: 0.66,
    context: 131_072,
    bestFor: "structured writing and narrative argument",
  },
  {
    id: "aionlabs/aion-3.0-mini",
    provider: "aionlabs",
    modelId: "aion-labs/aion-3.0-mini",
    label: "Aion 3.0 Mini",
    vision: false,
    reasoning: false,
    quality: 0.78,
    speed: 0.87,
    context: 131_072,
    bestFor: "cheap drafts and rewrites",
  },
  {
    id: "aionlabs/aion-2.0",
    provider: "aionlabs",
    modelId: "aion-labs/aion-2.0",
    label: "Aion 2.0",
    vision: false,
    reasoning: true,
    quality: 0.8,
    speed: 0.72,
    context: 131_072,
    bestFor: "expressive long-form prose",
  },
  {
    id: "aionlabs/aion-rp",
    provider: "aionlabs",
    modelId: "aion-labs/aion-rp-llama-3.1-8b",
    label: "Aion RP 8B",
    vision: false,
    reasoning: false,
    quality: 0.55,
    speed: 0.95,
    context: 16_384,
    bestFor: "roleplay and character voice",
  },

  // --- Requesty -------------------------------------------------------------
  // Probed one model at a time on 2026-11-19. Two findings shape this list:
  //  - The account has no paid balance: every priced model answers 402 "balance
  //    is too low", including the obvious frontier ids. Only the router's
  //    zero-price models answer, which is the same shape as Eden above — a key
  //    that works, for a subset.
  //  - The catalogue is not the roster. `mistral/leanstral-1-5` is listed and
  //    answers 400 "Invalid model", and `nvidia/nemotron-3-nano-30b-a3b` is
  //    listed and answers 410 Gone, so neither is registered.
  // These three were each answered with a real completion. All are reasoning
  // models, so a small `max_tokens` comes back empty — `requesty.check` takes a
  // budget for exactly that reason. Vision is advertised on Gemma but was not
  // probed, so no image turn is routed here yet.
  {
    id: "requesty/nemotron-3.5-lightning",
    provider: "requesty",
    modelId: "nvidia/nemotron-3.5-lightning-30b-a3b",
    label: "Nemotron 3.5 Lightning",
    vision: false,
    reasoning: true,
    quality: 0.82,
    speed: 0.9,
    context: 1_048_576,
    bestFor: "a fast answer over a million tokens, at no cost",
  },
  {
    id: "requesty/nemotron-3-ultra-550b",
    provider: "requesty",
    modelId: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra 550B",
    vision: false,
    reasoning: true,
    quality: 0.88,
    speed: 0.5,
    context: 1_048_576,
    bestFor: "deliberate reasoning when the answer matters more than the wait",
  },
  {
    id: "requesty/gemma-4-31b",
    provider: "requesty",
    modelId: "google/gemma-4-31b-it",
    label: "Gemma 4 31B",
    vision: false,
    reasoning: true,
    quality: 0.78,
    speed: 0.7,
    context: 262_144,
    bestFor: "steady everyday answers from an open model",
  },

  // --- Public AI ------------------------------------------------------------
  // Probed one at a time on 2026-11-19. The catalogue publishes no context
  // window, so the values below are a conservative 32k rather than an invented
  // headline number: too low only means a very long prompt routes elsewhere,
  // which is the safe way to be wrong. ALIA thinks before it answers, which is
  // why it is slower than the Apertus models and marked accordingly.
  {
    id: "publicai/apertus-v1.5-70b",
    provider: "publicai",
    modelId: "swiss-ai/apertus-v1.5-70b",
    label: "Apertus 1.5 70B",
    vision: false,
    reasoning: false,
    quality: 0.72,
    speed: 0.86,
    context: 32_768,
    bestFor: "an open-weight general answer with no cost attached",
  },
  {
    id: "publicai/nemotron-sea-lion-120b",
    provider: "publicai",
    modelId: "aisingapore/Nemotron-SEA-LION-v4.8-120B-A12B",
    label: "Nemotron SEA-LION 120B",
    vision: false,
    reasoning: false,
    quality: 0.78,
    speed: 0.8,
    context: 32_768,
    bestFor: "multilingual answers, especially Southeast Asian languages",
  },
  {
    id: "publicai/alia-40b",
    provider: "publicai",
    modelId: "BSC-LT/ALIA-40b-instruct",
    label: "ALIA 40B",
    vision: false,
    reasoning: false,
    quality: 0.7,
    speed: 0.5,
    context: 32_768,
    bestFor: "Spanish, Catalan, Basque and Galician writing",
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
  // Code wants correctness before speed, and a model that thinks before
  // writing is worth waiting a little for — but not as long as a proof.
  code: { quality: 0.64, speed: 0.2, reasoning: 0.16 },
  // Translation is mostly throughput: a strong model that answers quickly.
  translate: { quality: 0.72, speed: 0.3, reasoning: 0 },
  title: { quality: 0.3, speed: 0.7, reasoning: 0 },
  live: { quality: 0.38, speed: 0.62, reasoning: 0 },
};

/**
 * What each kind of turn wants from a model, in the engine's own words.
 *
 * `bestFor` already says what an engine is good at ("agentic work — tools, code,
 * 1M context", "step-by-step maths"), so a small bonus for a matching phrase
 * turns that prose into a routing signal instead of leaving it as a comment in
 * the inspector.
 */
const AFFINITY: Partial<Record<EngineTask, { hint: RegExp; note: string }>> = {
  code: {
    hint: /\b(code|coding|program|developer|agentic|tools)\b/i,
    note: "built for code",
  },
  reason: {
    hint: /\b(maths?|math|reason|logic|step-by-step)\b/i,
    note: "strong at reasoning",
  },
  research: {
    hint: /\b(research|citations?|sources?|web|search)\b/i,
    note: "reads the web",
  },
  summarize: {
    hint: /\b(context|long|fast|summar)\b/i,
    note: "holds long documents",
  },
  translate: {
    hint: /\b(multilingual|language|translat|indic|hindi)\b/i,
    note: "multilingual",
  },
  vision: { hint: /\b(vision|image|images|visual)\b/i, note: "sees images" },
};

/** How much a matching `bestFor` phrase is worth. Small: it breaks ties. */
const AFFINITY_BONUS = 0.06;

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
  /** Model plugins the user has switched on for chat (`PluginEntry.slug`). */
  enabledPlugins?: string[];
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

  // Roughly four characters per token. An engine whose window is smaller than
  // the prompt cannot answer it faithfully, so it is dropped rather than
  // ranked — a truncated question gets a confident wrong answer.
  const promptTokens = request.promptChars
    ? Math.ceil(request.promptChars / 4)
    : 0;
  const affinity = AFFINITY[task] ?? null;

  const scored: RankedEngine[] = [];
  for (const engine of ENGINES) {
    if (excluded && engine.id === excluded) continue;
    if (isRetired(engine.id)) continue;
    if (wantImages && !engine.vision) continue;
    if (promptTokens > engine.context) continue;

    const provider = providerById(engine.provider);

    const gate = provider?.plugins.find((p) => p.slug === engine.modelId);
    if (
      gate &&
      !gate.enabled &&
      !(preferred && engine.id === preferred) &&
      !(request.enabledPlugins ?? []).includes(gate.slug)
    ) {
      continue;
    }

    const available = provider ? Boolean(providerKey(provider)) : false;

    let score = smart
      ? engine.quality * weights.quality +
        engine.speed * weights.speed +
        (engine.reasoning ? weights.reasoning : 0)
      : 0;

    if (request.promptChars && request.promptChars > LONG_PROMPT_CHARS) {
      score += 0.1 * Math.min(1, engine.context / 131_072);
    }

    const matchesTask = affinity ? affinity.hint.test(engine.bestFor) : false;
    if (matchesTask) score += AFFINITY_BONUS;

    if (preferred && engine.id === preferred) score += 10;
    if (!smart) {
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

    const reasons: string[] = [];
    if (matchesTask && affinity) reasons.push(affinity.note);
    reasons.push(engine.bestFor);
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

  // Translation before code: "translate this function's comment" is a
  // translation turn even though it mentions code.
  if (/\btranslat(e|es|ed|ing|ion)\b/.test(lower)) return "translate";

  // Build-and-fix requests. Deliberately concrete tokens: "api" or "test" on
  // their own would catch ordinary questions ("what's the weather api?").
  const code =
    /\b(function|code|coding|bug|debug|refactor|regex|sql|compile|stack trace|typescript|javascript|python|rust|java|react|component|css|html|endpoint|backend|frontend|unit test|test suite|git|docker|exception|syntax error)\b/.test(
      lower,
    );
  if (code) return "code";

  const reason =
    /\b(solve|derive|proof|integral|derivative|differentiate|equation|matrix|determinant|regression|probability|algorithm|complexity|optimi[sz]e|why does|step[- ]by[- ]step|calculate|simplify|factori[sz]e)\b/.test(
      lower,
    );
  if (reason) return "reason";

  // `summarize` has its own weights but nothing ever selected it before: a
  // "tl;dr this document" turn was routed as general chat.
  const summarize =
    /\b(summari[sz]e|summari[sz]ed|summary|tldr|tl;dr|key (points|takeaways)|condense|recap|brief me)\b/.test(
      lower,
    );
  if (summarize) return "summarize";

  const research =
    /\b(research|investigate|find out|compare|latest|news|what happened|state of|market|history of|why (is|are|do|does|did))\b/.test(
      lower,
    );
  if (research) return "research";

  return "chat";
}
