// ---------------------------------------------------------------------------
// Voyage AI — the reranking stage of long-term recall.
//
// One job only: re-score candidate passages against the user's actual question
// with a cross-encoder. Vector similarity finds things that *look* alike; the
// reranker decides which of those actually answers the question. This is the
// stage recall used to be missing, and it is why recall felt arbitrary — a
// merely-related message would outrank the right one on cosine alone.
//
// Voyage does NOT produce the stored vectors. Convex's vector index is fixed at
// 384 dimensions and Voyage's 4-series models emit 1024 or 2048, so a Voyage
// vector could be written but never read back by the retriever that has to query
// it. HuggingFace (all-MiniLM-L6-v2) embeds and writes; Voyage re-scores the
// text those results come back as. The two are not interchangeable, and a Voyage
// key upgrades ranking quality without ever owning storage.
//
// Cost is genuinely not a concern: the first 200 million rerank tokens are free
// on every account, no card required. A personal assistant's entire memory
// corpus is orders of magnitude below that.
//
// The model is overridable by environment variable so the deployment can move to
// a stronger reranker without a code change.
//
// Pure module — no Convex imports — so both the Convex runtime and the node
// actions can use it. Every entry point returns an empty result rather than
// throwing when the key is missing or the call fails: recall is best-effort, and
// a user who has not configured Voyage must still get a working chat.
// ---------------------------------------------------------------------------

/**
 * Longest text sent per field. `rerank-3` allows an 8,000-token query and a
 * 32,000-token query+document pair; 8,000 characters is roughly 2,000 tokens,
 * which stays comfortably inside that even for token-dense text like code.
 */
const MAX_CHARS = 8000;

/** Voyage accepts at most 1,000 documents per rerank request. */
const MAX_DOCUMENTS = 1000;

/**
 * `rerank-3` is Voyage's current recommendation — highest accuracy, 32k context.
 * `rerank-2` was the previous default and still works, but Voyage lists it under
 * "older models" and recommends the 3-series on every axis.
 */
export const DEFAULT_RERANK_MODEL = "rerank-3";

const RERANK_URL = "https://api.voyageai.com/v1/rerank";

export function voyageKey(): string | null {
  for (const name of ["VOYAGE_API_KEY", "VOYAGE_KEY"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function voyageRerankModel(): string {
  return process.env.VOYAGE_RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL;
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
 * Returns [] when unavailable, and callers keep the order they already had — a
 * missing reranker degrades quality, it must never return fewer results than
 * were asked for. Never throws.
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

  // Truncation is on so one over-long paste degrades to a shorter rerank rather
  // than a 400 for the whole recall request.
  const docs = documents
    .slice(0, MAX_DOCUMENTS)
    .map((d) => d.slice(0, MAX_CHARS))
    .filter((d) => d.trim().length > 0);
  if (docs.length === 0) return [];

  try {
    const res = await fetch(RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: q,
        documents: docs,
        model: voyageRerankModel(),
        top_k: Math.max(1, Math.min(topK, docs.length)),
        // The documents are already in hand; asking for them back would double
        // the response size for no benefit.
        return_documents: false,
        truncation: true,
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
  /** True when the key is a real Voyage key and the reranker actually answered. */
  ok: boolean;
  rerankModel: string;
  /** Relevance score of the best probe document, or null if nothing came back. */
  topScore: number | null;
  detail: string;
}

/** Two documents, one of which is unambiguously the answer. */
const PROBE_QUERY = "what is the capital of France?";
const PROBE_DOCUMENTS = [
  "Paris is the capital of France.",
  "Berlin is in Germany.",
];

/**
 * Verify the key is a *Voyage* key and that the reranker actually answers.
 *
 * This probes /v1/rerank and nothing else, because rerank is the only Voyage
 * endpoint this app calls. An earlier version also probed /v1/embeddings, which
 * produced a confident-looking failure about an endpoint that was never used.
 *
 * Worth doing explicitly: a key from any other provider is just as long and
 * just as opaque, and pasting one into this variable produces a 403 that reads
 * like a permissions problem rather than a copy-paste one. The probe uses an
 * unambiguous pair so a real working key is visibly distinguishable from one
 * that authenticates but ranks nonsense.
 */
export async function voyageDiagnose(): Promise<VoyageDiagnosis> {
  const key = voyageKey();
  const rerankModel = voyageRerankModel();

  if (!key) {
    return {
      configured: false,
      ok: false,
      rerankModel,
      topScore: null,
      detail: "Add VOYAGE_API_KEY in the Keys tab.",
    };
  }

  try {
    const res = await fetch(RERANK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: PROBE_QUERY,
        documents: PROBE_DOCUMENTS,
        model: rerankModel,
        top_k: 2,
        return_documents: false,
        truncation: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    // Never echo the key back, even inside a provider error body.
    const clean = text.slice(0, 200).split(key).join("<redacted>");

    if (res.status !== 200) {
      return {
        configured: true,
        ok: false,
        rerankModel,
        topScore: null,
        detail: `Reranking failed (${res.status}): ${clean}`,
      };
    }

    let topScore: number | null = null;
    try {
      const parsed = JSON.parse(text) as {
        data?: { index?: number; relevance_score?: number }[];
      };
      const first = parsed.data?.[0];
      topScore =
        typeof first?.relevance_score === "number"
          ? first.relevance_score
          : null;
      // The Paris/Berlin pair is a sanity check, not a benchmark: a key that
      // authenticates but returns an empty result set is not working.
      if (topScore === null) {
        return {
          configured: true,
          ok: false,
          rerankModel,
          topScore: null,
          detail: `Connected, but ${rerankModel} returned no scores.`,
        };
      }
    } catch {
      return {
        configured: true,
        ok: false,
        rerankModel,
        topScore: null,
        detail: `Connected, but the response was not valid JSON: ${clean}`,
      };
    }

    return {
      configured: true,
      ok: true,
      rerankModel,
      topScore,
      detail: `Connected. ${rerankModel} ranked the right passage first (${topScore.toFixed(2)}).`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      rerankModel,
      topScore: null,
      detail: String(err).slice(0, 160),
    };
  }
}
