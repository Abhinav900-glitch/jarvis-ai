"use node";

// ---------------------------------------------------------------------------
// Model vault — the weights, and the server that runs them.
//
// Two independent things live behind one panel, because from the user's side
// they are one thought: "I have a GGUF on my disk and I want Jarvis to use
// it." Getting to that point needs a file somewhere a server can fetch it
// from (R2), and a running inference server reachable over HTTPS (a tunnel
// from the operator's machine, since Convex has no route to localhost).
//
// Every action here is authenticated. Presigned URLs are bearer credentials
// for the bucket, and the endpoint check reports internal configuration, so
// neither belongs behind a public function reference.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { providerById, providerUrl, engineModelId, engineById } from "./engines";
import {
  DEFAULT_MODEL_KEY,
  headObject,
  isSafeKey,
  presignDownload,
  presignUpload,
  r2Configured,
} from "./r2";

const LOCAL_ENGINE_ID = "local/fable-5";

export interface VaultStatus {
  storage: {
    configured: boolean;
    bucket: string | null;
    /** Whether the default weights object is already in the bucket. */
    uploaded: boolean;
    sizeBytes: number | null;
    key: string;
  };
  runtime: {
    configured: boolean;
    /** True only after a real /v1/models call comes back 200. */
    reachable: boolean;
    /** Model ids the server reports, so the UI can offer them. */
    models: string[];
    /** The id Jarvis will actually send on the wire. */
    selected: string;
    detail: string;
  };
}

/**
 * What the vault looks like right now.
 *
 * The local runtime is genuinely probed rather than inferred from the presence
 * of a URL, for the same reason the memory panel verifies its backends: a
 * tunnel that is stopped, a server that never finished loading the model, or a
 * model id the server does not recognise all produce exactly the same silence
 * from the chat side, and the only way to tell them apart is to ask.
 */
export const status = action({
  args: {},
  handler: async (ctx): Promise<VaultStatus> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const stored = await headObject(DEFAULT_MODEL_KEY);

    const provider = providerById("local");
    const base = provider ? providerUrl(provider) : "";
    const engine = engineById(LOCAL_ENGINE_ID);

    if (!base) {
      return {
        storage: {
          configured: r2Configured(),
          bucket: process.env.R2_BUCKET_NAME?.trim() ?? null,
          uploaded: stored.ok,
          sizeBytes: stored.size ?? null,
          key: DEFAULT_MODEL_KEY,
        },
        runtime: {
          configured: false,
          reachable: false,
          models: [],
          selected: engine ? engineModelId(engine) : "fable-5",
          detail: "Set LOCAL_LLM_BASE_URL to your server's public HTTPS address.",
        },
      };
    }

    // `/v1/models` is the cheapest call that proves three separate things: the
    // tunnel is up, the server speaks the OpenAI dialect, and the weights
    // finished loading. Each of those fails silently otherwise.
    const root = base.replace(/\/v1\/chat\/completions$/, "");
    let models: string[] = [];
    let reachable = false;
    let detail = "";

    try {
      const res = await fetch(`${root}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { id?: string }[] };
        models = (data.data ?? [])
          .map((m) => (typeof m.id === "string" ? m.id : ""))
          .filter(Boolean);
        reachable = true;
        const selected = engine ? engineModelId(engine) : "fable-5";
        detail = models.length
          ? models.includes(selected)
            ? `Connected. Serving ${models.length} model(s).`
            : `Connected, but "${selected}" is not loaded — available: ${models.join(", ")}.`
          : "Connected, but the server reported no models.";
      } else {
        detail = `The server answered ${res.status}. Is the base URL the server root rather than the full path?`;
      }
    } catch (err) {
      detail = `Could not reach the server (${String(err).slice(0, 120)}). If it runs on your own machine, the tunnel is probably down.`;
    }

    return {
      storage: {
        configured: r2Configured(),
        bucket: process.env.R2_BUCKET_NAME?.trim() ?? null,
        uploaded: stored.ok,
        sizeBytes: stored.size ?? null,
        key: DEFAULT_MODEL_KEY,
      },
      runtime: {
        configured: true,
        reachable,
        models,
        selected: engine ? engineModelId(engine) : "fable-5",
        detail,
      },
    };
  },
});

/**
 * A URL the browser can PUT the GGUF to.
 *
 * The file goes from the browser straight into R2 — it never passes through
 * Convex, which could not hold it and would not survive proxying it. The URL
 * expires in an hour, which is deliberately long enough for a multi-gigabyte
 * upload on a slow connection and short enough that a leaked URL is not a
 * permanent key to the bucket.
 */
export const presignUploadUrl = action({
  args: {
    key: v.optional(v.string()),
    expiresIn: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ url: string; key: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const key = args.key ?? DEFAULT_MODEL_KEY;
    if (!isSafeKey(key)) throw new Error("That file name is not allowed.");

    const url = await presignUpload(key, args.expiresIn);
    if (!url) throw new Error("Model storage is not configured yet.");
    return { url, key };
  },
});

/** A URL the browser can GET the weights from. */
export const presignDownloadUrl = action({
  args: {
    key: v.optional(v.string()),
    expiresIn: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ url: string; key: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const key = args.key ?? DEFAULT_MODEL_KEY;
    if (!isSafeKey(key)) throw new Error("That file name is not allowed.");

    const url = await presignDownload(key, args.expiresIn);
    if (!url) throw new Error("Model storage is not configured yet.");
    return { url, key };
  },
});