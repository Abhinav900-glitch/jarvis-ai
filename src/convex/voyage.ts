// ---------------------------------------------------------------------------
// Voyage AI — embeddings and reranking for long-term recall.
//
// Why this replaced the in-house sentence transformer: recall quality is the
// whole point of the memory feature, and two things were quietly capping it.
// The old embeddings were 384-dim MiniLM vectors from HuggingFace — cheap and
// decent, but the retrieval over them had no reranking stage, so the top-k was
// ordered purely by cosine similarity and a merely-related message could beat
// the right one. Voyage fixes both ends: materially better multilingual
// embeddings, and a cross-encoder reranker that re-scores the candidates
// against the actual query.
//
// Cost is genuinely not a concern here: the first 200 million tokens of
// voyage-4* embeddings, and of rerank-2*, are free on every account with no
// card. A personal assistant's entire memory corpus is orders of magnitude
// below that.
//
// The models are overridable by environment variable so the deployment can be
// moved to a stronger pair without a code change.
//
// Pure module — no Convex imports — so both the Convex runtime and the node
// actions can use it. Every entry point returns a null/empty result rather than
// throwing when the key is missing: recall is best-effort, and a user who has
// not configured Voyage yet must still get a working chat.
// ---------------------------------------------------------------------------

/** 1024 is Voyage's default and what every 4-series model produces. */
export const VOYAGE_DIMS = 1024;

/** Longest text sent for embedding. Voyage truncates at 32k tokens anyway. */
const MAX_CHARS = 8000;

/** Voyage accepts at most 1000 inputs per request. */
const MAX_BATCH = 128;

export const DEFAULT_EMBED_MODEL = "voyage-4-lite";
export const DEFAULT_RERANK_MODEL = "rerank-2";

const EMBED_URL = "https://api.voyageai.com/v1/embeddings";
const RERANK_URL = "https://api.voyageai.com/v1/rerank";

export function voyageKey(): string | null {
  for (const name of ["VOYAGE_API_KEY", "VOYAGE_KEY"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function voyageEmbedModel(): string {
  return process.env.VOYAGE_EMBED_MODEL?.trim() || DEFAULT_EMBED_MODEL;
}

export function voyageRerankModel(): string {
  return process.env.VOYAGE_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL;
}

/**
 * A "query" and a "document" are embedded differently on purpose.
 *
 * Voyage prepends a role-specific instruction, so the same sentence means
 * different things depending on which side of a search it sits on. Getting
 * this wrong quietly costs recall rather than erroring, which is exactly the
 * kind of bug that survives a year of testing.
 */
export type VoyageInputType = "query" | "document";

export interface VoyageEmbedOptions {
  inputType?: VoyageInputType;
  /** Skips the network entirely. Used when no key is configured. */
  key?: string | null;
}

/**
 * Embed one or more texts.
 *
 * Returns an empty array when Voyage is not configured or the call fails —
 * never throws. Callers fall back to their other provider.
 */
export async function voyageEmbed(
  texts: string[],
  options: VoyageEmbedOptions = {},
): Promise<number[][]> {
  const key = options.key === undefined ? voyageKey() : options.key;
  if (!key || texts.length === 0) return [];

  const input = texts
    .map((t) => t.slice(0, MAX_CHARS))
    .filter((t) => t.trim().length > 0);
  if (input.length === 0) return [];

  try {
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: input.slice(0, MAX_BATCH),
        model: voyageEmbedModel(),
        input_type: options.inputType ?? "document",
        // A chat message longer than the model's window must be truncated
        // rather than rejected, or one long paste breaks indexing for the turn.
        truncation: true,
        output_dimension: VOYAGE_DIMS,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[voyage] embed failed (${res.status}): ${detail.slice(0, 200)}`,
      );
      return [];
    }

    const data = (await res.json()) as {
      data?: { embedding?: number[]; index?: number }[];
    };
    const rows = data.data ?? [];
    if (rows.length !== input.length) {
      console.error(
        `[voyage] expected ${input.length} embeddings, got ${rows.length}`,
      );
      return [];
    }

    // The API does not guarantee order, so results are placed by their stated
    // index rather than by position. Trusting arrival order here would
    // silently attach the wrong vector to the wrong message.
    const out: number[][] = new Array(input.length);
    for (const row of rows) {
      const vector = row.embedding;
      if (!Array.isArray(vector) || vector.length !== VOYAGE_DIMS) continue;
      const at = typeof row.index === "number" ? row.index : 0;
      if (at >= 0 && at < out.length) out[at] = vector;
    }
    return out.every((v) => Array.isArray(v)) ? out : [];
  } catch (err) {
    console.error("[voyage] embed error:", err);
    return [];
  }
}

export interface RerankResult {
  /** Index into the documents array that was passed in. */
  index: number;
  /** 0..1 relevance. Higher is a closer match to the query. */
  score: number;
}

/**
 * Re-score candidate documents against the query with a cross-encoder.
 *
 * This is the step that makes retrieval feel right: vector similarity finds
 * things that *look* alike, and the reranker decides which of those actually
 * answers the question. Returns [] when unavailable, and callers keep the
 * order they already had — a missing reranker degrades quality, it must never
 * return fewer results than were asked for.
 */
export async function voyageRerank(
  query: string,
  documents: string[],
  topK = documents.length,
  options: { key?: string | null } = {},
): Promise<RerankResult[]> {
  const key = options.key === undefined ? voyageKey() : options.key;
  if (!key || documents.length === 0) return [];
  const q = query.slice(0, MAX_CHARS).trim();
  if (!q) return [];

  try {
    const res = await fetch(RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        documents: documents.slice(0, 1000).map((d) => d.slice(0, MAX_CHARS)),
        model: voyageRerankModel(),
        top_k: Math.max(1, Math.min(topK, documents.length)),
        // The documents are already in hand; asking for them back would double
        // the response size for no benefit.
        return_documents: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[voyage] rerank failed (${res.status}): ${detail.slice(0, 200)}`,
      );
      return [];
    }

    const data = (await res.json()) as {
      data?: { index?: number; relevance_score?: number }[];
    };
    return (data.data ?? [])
      .map((row) => ({
        index: typeof row.index === "number" ? row.index : -1,
        score: typeof row.relevance_score === "number" ? row.relevance_score : 0,
      }))
      .filter((row) => row.index >= 0)
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error("[voyage] rerank error:", err);
    return [];
  }
}

export interface VoyageDiagnosis {
  configured: boolean;
  ok: boolean;
  embedModel: string;
  rerankModel: string;
  /** Dimension the endpoint actually returned, if any. */
  dimension: number | null;
  detail: string;
}

/**
 * Verify the key is a *Voyage* key and that both endpoints work.
 *
 * Worth doing explicitly: a key from any other provider is just as long and
 * just as opaque, and pasting one into this variable produces a 403 that reads
 * like a permissions problem rather than a copy-paste one.
 */
export async function voyageDiagnose(): Promise<VoyageDiagnosis> {
  const key = voyageKey();
  const embedModel = voyageEmbedModel();
  const rerankModel = voyageRerankModel();

  if (!key) {
    return {
      configured: false,
      ok: false,
      embedModel,
      rerankModel,
      dimension: null,
      detail: "Add VOYAGE_API_KEY in the Keys tab.",
    };
  }

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, text: await res.text() };
  };

  try {
    const emb = await post(EMBED_URL, {
      input: ["connectivity check"],
      model: embedModel,
      input_type: "document",
      truncation: true,
      output_dimension: VOYAGE_DIMS,
    });
    let dimension: number | null = null;
    try {
      const parsed = JSON.parse(emb.text) as {
        data?: { embedding?: number[] }[];
      };
      dimension = parsed.data?.[0]?.embedding?.length ?? null;
    } catch {
      // leave null; the status line below carries the reason
    }

    const rer = await post(RERANK_URL, {
      query: "what is the capital of France?",
      documents: ["Paris is the capital of France.", "Berlin is in Germany."],
      model: rerankModel,
      top_k: 2,
      return_documents: false,
    });

    const clean = (t: string) =>
      t.slice(0, 200).split(key).join("<redacted>");
    const embedOk = emb.status === 200;
    const rerankOk = rer.status === 200;

    return {
      configured: true,
      ok: embedOk && rerankOk,
      embedModel,
      rerankModel,
      dimension,
      detail: embedOk
        ? rerankOk
          ? `Connected. ${dimension}-dim embeddings, reranking on.`
          : `Embeddings work, but reranking failed (${rer.status}): ${clean(rer.text)}`
        : `Embeddings failed (${emb.status}): ${clean(emb.text)}`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      embedModel,
      rerankModel,
      dimension: null,
      detail: String(err).slice(0, 160),
    };
  }
}

/**
 * Cosine similarity between two equal-length vectors.
 *
 * Only used for the in-memory fallback ranking, where the corpus is small
 * enough that an approximate nearest-neighbour index would be more machinery
 * than the problem deserves.
 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}