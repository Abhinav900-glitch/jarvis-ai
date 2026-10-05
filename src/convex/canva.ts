/**
 * Canva image generation — server-to-server, with no end-user OAuth.
 *
 * Canva's `POST /v1/image-generations` declares two *alternative* security
 * schemes in its OpenAPI description:
 *
 *     security:
 *     - oauthClientCredentials: []      <- app-only token, no scopes
 *     - oauthAuthCode:
 *       - asset:write                   <- per-user token
 *
 * The client-credentials branch is the one used here: no user token, no
 * consent screen, no callback route. The per-user branch is only needed to
 * *save* the result into a user's Canva account (`asset_upload.type: upload`),
 * which this provider never asks for — it returns a plain download URL that
 * the caller persists to our own Cloudinary.
 *
 * Contract verified against the published spec:
 *   https://www.canva.dev/sources/connect/api/latest/api.yml
 */

const CANVA_API_BASE = "https://api.canva.com/rest";
const CANVA_TOKEN_URL = "https://api.canva.com/auth/v1/oauth/token";

/**
 * Canva rate-limits these calls per client user: 20 job creations and 120 job
 * reads. The poll budget below is sized to stay well inside the read limit
 * even on the slowest allowed job.
 */
const JOB_POLL_INTERVAL_MS = 1_500;
const JOB_TIMEOUT_MS = 90_000;
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

let cachedToken: { token: string; expiresAt: number } | null = null;

function canvaConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Canva credentials not configured. Add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Client-credentials access token, cached until shortly before it expires.
 *
 * A cached token is module state, not a durable cache: a Convex cold start
 * simply re-mints one, which is cheap and keeps a stale token from ever
 * outliving a revocation.
 */
export async function getCanvaAccessToken(): Promise<string> {
  if (
    cachedToken &&
    cachedToken.expiresAt - TOKEN_EXPIRY_SAFETY_MS > Date.now()
  ) {
    return cachedToken.token;
  }

  const { clientId, clientSecret } = canvaConfig();
  const res = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[canva] token request failed", res.status, detail);
    throw new Error(
      `Canva auth failed (${res.status}). Check CANVA_CLIENT_ID and CANVA_CLIENT_SECRET.`,
    );
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new Error("Canva auth response contained no access_token.");
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/** Drop the cached token — used when Canva rejects one as expired. */
function invalidateCanvaToken() {
  cachedToken = null;
}

export type CanvaAspectRatio = "square" | "landscape" | "portrait";

/**
 * Canva only offers three shapes (1:1, 16:9, 9:16). The app's own ratios are
 * 1:1 / 3:2 / 2:3, so 3:2 lands on landscape and 2:3 on portrait — the nearest
 * shape Canva can actually produce. Anything unrecognised falls back to
 * square rather than being sent through as an invalid enum value.
 */
export function toCanvaAspectRatio(ratio?: string): CanvaAspectRatio {
  if (ratio === "3:2") return "landscape";
  if (ratio === "2:3") return "portrait";
  return "square";
}

export type CanvaModel = "lucid_origin" | "z_image_turbo";

const CANVA_MODELS: readonly string[] = ["lucid_origin", "z_image_turbo"];

/**
 * Canva documents that "if the requested model can't serve the request, the
 * job fails" and that it "never uses a different model to serve the request".
 * So a model name meant for another provider (flux, gpt-image-1, …) must be
 * dropped rather than forwarded — forwarding it would fail the job outright
 * instead of letting Canva choose.
 */
export function toCanvaModel(model?: string): CanvaModel | undefined {
  if (!model) return undefined;
  return CANVA_MODELS.includes(model) ? (model as CanvaModel) : undefined;
}

/** Pull `{code, message}` out of an error body, tolerating both known shapes. */
function parseCanvaError(text: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(text) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    return {
      code: parsed.code ?? parsed.error?.code,
      message: parsed.message ?? parsed.error?.message,
    };
  } catch {
    return {};
  }
}

/** Turn a non-2xx response into a message that says what to actually do. */
function canvaHttpError(status: number, text: string, what: string): Error {
  const { code, message } = parseCanvaError(text);
  const detail = message
    ? `${message} (${code ?? "no code"})`
    : `HTTP ${status}`;

  if (status === 403) {
    return new Error(
      `Canva ${what} refused: ${detail}. Image generation must be enabled for your Canva integration at https://www.canva.com/developers/`,
    );
  }
  if (status === 429 || code === "credit_quota_exceeded") {
    return new Error(
      `Canva ${what} hit the AI credit limit (${detail}). Raise the allowance at https://www.canva.com/help/ai-access/`,
    );
  }
  if (status === 401) {
    invalidateCanvaToken();
    return new Error(`Canva ${what} was unauthenticated (${detail}).`);
  }
  return new Error(`Canva ${what} failed: ${detail}`);
}

export interface CanvaGeneratedImage {
  bytes: ArrayBuffer;
  /**
   * Canva's own download URL. Only valid for 24 hours, so it is a fallback for
   * showing the image right now — never something to persist as the asset.
   */
  downloadUrl: string;
  width?: number;
  height?: number;
}

export interface CanvaGenerateOptions {
  /** App-level model name; silently dropped when Canva doesn't offer it. */
  model?: string;
  /** App-level ratio ("1:1" | "3:2" | "2:3"); mapped to Canva's three shapes. */
  aspectRatio?: string;
}

/**
 * Generate one image and return its raw bytes.
 *
 * The caller is responsible for persisting them: Canva's download URL is only
 * valid for 24 hours, so it must not be stored as a long-lived asset URL.
 */
export async function generateImageViaCanva(
  prompt: string,
  opts: CanvaGenerateOptions = {},
): Promise<CanvaGeneratedImage> {
  const token = await getCanvaAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const body: Record<string, unknown> = {
    prompt,
    // Makes a retried create return the original job instead of burning a
    // second credit. Held by Canva for 24 hours.
    idempotency_key: crypto.randomUUID(),
    aspect_ratio: toCanvaAspectRatio(opts.aspectRatio),
    // asset_upload is deliberately omitted: `type: "upload"` would need a
    // per-user token, which is the OAuth this provider exists to avoid.
  };
  const model = toCanvaModel(opts.model);
  if (model) body.model = model;

  const created = await fetch(`${CANVA_API_BASE}/v1/image-generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!created.ok) {
    throw canvaHttpError(
      created.status,
      await created.text().catch(() => ""),
      "generation",
    );
  }

  const createdBody = (await created.json()) as {
    job?: { id?: string; status?: string };
  };
  const jobId = createdBody.job?.id;
  if (!jobId) throw new Error("Canva returned no image generation job id.");

  // Poll to completion. A job that is still running at the deadline throws
  // rather than returning a partial result, so the ladder moves on cleanly.
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let downloadUrl: string | undefined;
  let width: number | undefined;
  let height: number | undefined;

  while (Date.now() < deadline) {
    await sleep(JOB_POLL_INTERVAL_MS);

    const polled = await fetch(
      `${CANVA_API_BASE}/v1/image-generations/${jobId}`,
      { headers },
    );
    if (!polled.ok) {
      throw canvaHttpError(
        polled.status,
        await polled.text().catch(() => ""),
        "job poll",
      );
    }

    const { job } = (await polled.json()) as {
      job?: {
        status?: "in_progress" | "success" | "failed";
        result?: { image?: { url?: string; width?: number; height?: number } };
        error?: { code?: string; message?: string };
      };
    };

    if (job?.status === "success") {
      downloadUrl = job.result?.image?.url;
      width = job.result?.image?.width;
      height = job.result?.image?.height;
      break;
    }
    if (job?.status === "failed") {
      throw new Error(
        `Canva generation job failed: ${job.error?.message ?? "no reason given"} (${
          job.error?.code ?? "no code"
        })`,
      );
    }
  }

  if (!downloadUrl) {
    throw new Error(
      `Canva generation job ${jobId} did not finish within ${
        JOB_TIMEOUT_MS / 1000
      }s.`,
    );
  }

  const image = await fetch(downloadUrl);
  if (!image.ok) {
    throw new Error(`Could not download the Canva image (${image.status}).`);
  }

  return { bytes: await image.arrayBuffer(), downloadUrl, width, height };
}
