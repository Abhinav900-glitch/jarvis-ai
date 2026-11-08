// ---------------------------------------------------------------------------
// Which keyed image providers exist — the one place the environment variable
// names are written down.
//
// Two different callers need this answer and must never disagree: the image
// chain in `cloudinary.ts`, which reads the key values to call the providers,
// and the `config.imageProviders` query, which reports only *whether* one is
// configured so the client can decide where to start. Splitting the names
// across both files is how a working key ends up ignored by one of them — the
// Cloudflare key in this project was already stored under a misspelling, and a
// second, slightly different list would have hidden it again.
//
// Availability here is key *presence*, never key material, and nothing is
// user-specific, so the query that exposes it needs no auth.
// ---------------------------------------------------------------------------

export const FAL_KEY_ENVS = [
  "FAL_KEY",
  "FAL_API_KEY",
  "FAL_AI_API",
  "FALAI_API_KEY",
] as const;

export const META_KEY_ENVS = [
  "MODEL_API_KEY",
  "META_AI_API_KEY",
  "META_API_KEY",
] as const;

/**
 * Workers AI is account-scoped, so the key alone is not enough: the URL itself
 * carries the account id. Both spellings of the key are accepted because the
 * platform's Keys tab has stored it as `CLOUDFARE_WORKERS_API_KEY` (one L).
 */
export const CF_KEY_ENVS = [
  "CLOUDFARE_WORKERS_API_KEY",
  "CLOUDFLARE_WORKERS_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
] as const;

export const CF_ACCOUNT_ENVS = ["CLOUDFLARE_ACCOUNT_ID"] as const;

/** First non-empty value among `names`, trimmed. */
export function readEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export interface ImageProviderStatus {
  /** Matches the `provider` field the generation chain returns. */
  id: string;
  label: string;
  available: boolean;
}

/**
 * The keyed providers, in the order the generation chain tries them.
 *
 * Only providers that need a secret are listed. The keyless legs (Pollinations,
 * Perchance, AI Horde) are always available, so including them would tell the
 * client nothing it could act on.
 */
export function imageProviderStatuses(): ImageProviderStatus[] {
  return [
    {
      id: "cloudflare-workers-ai",
      label: "Cloudflare Workers AI",
      available: Boolean(readEnv(CF_KEY_ENVS) && readEnv(CF_ACCOUNT_ENVS)),
    },
    {
      id: "fal",
      label: "fal.ai FLUX",
      available: Boolean(readEnv(FAL_KEY_ENVS)),
    },
    {
      id: "meta",
      label: "Meta AI",
      available: Boolean(readEnv(META_KEY_ENVS)),
    },
  ];
}
