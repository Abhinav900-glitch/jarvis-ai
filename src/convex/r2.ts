// ---------------------------------------------------------------------------
// Cloudflare R2 — object storage for the GGUF weights.
//
// Why a bucket and not a database
// ------------------------------
// A 2.17 GB model file cannot go in Convex: documents are capped around 1 MB
// and even the paid file storage tops out far below this. Nor should it pass
// through Convex at all — an action that read a 2 GB body into memory to write
// it somewhere else would cost a fortune and time out.
//
// So the bytes go browser → R2 directly, over a presigned URL that expires in
// an hour. Convex only ever mints that URL; it never sees the file. That is the
// whole design, and it is why this module is only SigV4 string-building and
// nothing heavier.
//
// R2 rather than S3 because the free tier is 10 GB with zero egress, and the
// weights are pulled from this bucket repeatedly while the model runs
// somewhere else.
//
// SigV4 is hand-rolled rather than pulled from the AWS SDK: the SDK is a large
// dependency whose only job here would be to compute one signature, and this
// file is the entire surface it would replace.
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** S3 endpoint for this account. R2 ignores the region and uses "auto". */
  endpoint: string;
}

export function r2Config(): R2Config | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

export function r2Configured(): boolean {
  return r2Config() !== null;
}

/** Where model weights live by default. */
export const DEFAULT_MODEL_KEY = "models/fable-5.gguf";

/**
 * Object keys are constrained rather than escaped.
 *
 * This string is interpolated into a path that a credential is attached to. A
 * key containing `..` or a query character would either escape the bucket
 * prefix or smuggle extra parameters into a URL that is already signed — so
 * anything outside a conservative allow-list is rejected outright rather than
 * encoded and hoped for.
 */
export function isSafeKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(key) &&
    !key.includes("..")
  );
}

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

/** S3 wants each path segment encoded, but the separators left alone. */
function canonicalUri(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function amzDate(now: Date): { stamp: string; short: string } {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { stamp, short: stamp.slice(0, 8) };
}

/**
 * A presigned URL for one object operation.
 *
 * Returns null when R2 is not configured or the key is rejected, so the caller
 * can report a configuration problem rather than hand the browser a URL that
 * will fail with an opaque signature error.
 */
export async function presign(options: {
  method: "PUT" | "GET";
  key: string;
  /** Seconds. R2 caps presigned URLs at 7 days; an hour is the useful case. */
  expiresIn?: number;
}): Promise<string | null> {
  const config = r2Config();
  if (!config) return null;
  if (!isSafeKey(options.key)) return null;

  const method = options.method;
  const expires = Math.min(Math.max(options.expiresIn ?? 3600, 60), 604_800);

  const url = new URL(`${config.endpoint}/${config.bucket}`);
  const canonicalPath = canonicalUri(`/${options.key}`);
  const host = url.host;

  const { stamp, short } = amzDate(new Date());

  const query = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    [
      "X-Amz-Credential",
      `${config.accessKeyId}/${short}/auto/s3/aws4_request`,
    ],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expires)],
    ["X-Amz-SignedHeaders", "host"],
  ]
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  // `UNSIGNED-PAYLOAD` is what makes this presigned rather than a signed
  // request: the body is not covered by the signature, so the browser can send
  // gigabytes without Convex ever hashing them.
  const canonicalRequest = [
    method,
    canonicalPath,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const scope = `${short}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${config.secretAccessKey}`), short);
  const kRegion = await hmac(kDate, "auto");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(
    (await hmac(kSigning, stringToSign)).buffer as ArrayBuffer,
  );

  return `${config.endpoint}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

/** Presigned URL for the browser to download the weights with. */
export async function presignDownload(key: string, expiresIn?: number): Promise<string | null> {
  return presign({ method: "GET", key, expiresIn });
}

/** Presigned URL for the browser to upload the weights to. */
export async function presignUpload(key: string, expiresIn?: number): Promise<string | null> {
  return presign({ method: "PUT", key, expiresIn });
}

/**
 * Ask R2 about one object without downloading it.
 *
 * The weight file is far too large to inspect, but its existence and size are
 * exactly what the UI needs in order to say "this is already uploaded" instead
 * of always showing an empty state.
 */
export async function headObject(
  key: string,
): Promise<{ ok: boolean; size?: number; contentType?: string; status: number }> {
  const config = r2Config();
  if (!config) return { ok: false, status: 0 };

  const url = await presign({ method: "GET", key, expiresIn: 900 });
  if (!url) return { ok: false, status: 0 };

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(20_000),
    });
    const size = Number(res.headers.get("content-length") ?? "0");
    return {
      ok: res.ok,
      status: res.status,
      ...(res.ok && size > 0 ? { size, contentType: res.headers.get("content-type") ?? "" } : {}),
    };
  } catch (err) {
    console.error("[r2] headObject failed:", err);
    return { ok: false, status: 0 };
  }
}