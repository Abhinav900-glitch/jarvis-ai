// ---------------------------------------------------------------------------
// Parallel AI — Search API (`POST /v1/search`).
//
// Shape only: this module builds the request body and reads the response, and
// `src/convex/ai.ts` does the fetch. Kept pure so the version-sensitive part —
// Parallel moved `max_results` and the excerpt settings *inside*
// `advanced_settings` for GA, and sending the old beta shape at `/v1` is a 422,
// not a deprecation warning — is covered by a test rather than by memory.
//
// Why this provider: it is the only one in the research chain that is asked for
// excerpts. Like Exa it returns the page text alongside the hit, so the answer
// is written from what the sources say. Parallel's own `fast` mode is tuned for
// agent use (roughly a second), which is why it is the mode used here and not
// the slower `advanced` default.
// ---------------------------------------------------------------------------

export const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1/search";

/** How many hits to ask for — Parallel caps this at 20. */
export const PARALLEL_MAX_RESULTS = 8;
/** Characters of excerpt per source, and across the whole response. */
export const PARALLEL_CHARS_PER_RESULT = 900;
export const PARALLEL_CHARS_TOTAL = 8_000;
/** Search queries are capped at 200 characters by the API. */
const MAX_QUERY_CHARS = 200;
/** `objective` is capped at 5,000 characters. */
const MAX_OBJECTIVE_CHARS = 5_000;

export interface ParallelHit {
  title?: string | null;
  url?: string;
  publish_date?: string | null;
  /** Flat list of excerpts — not an object, and not a single string. */
  excerpts?: string[] | null;
}

export interface ParallelPayload {
  results?: ParallelHit[] | null;
  warnings?: unknown;
}

/**
 * The request body for one search.
 *
 * `search_queries` is the one required field, and the API wants short queries
 * (three to six words). The user's question goes in as `objective` at full
 * length, so a long, specific question still steers the ranking even though the
 * query itself has to be trimmed.
 */
export function parallelRequestBody(query: string): Record<string, unknown> {
  const objective = query.trim().slice(0, MAX_OBJECTIVE_CHARS);
  const searchQuery =
    objective.replace(/\s+/g, " ").slice(0, MAX_QUERY_CHARS).trim() || objective;

  return {
    objective,
    search_queries: [searchQuery],
    // Agent-tuned and about a second; the API's default is `advanced`, which
    // spends far longer on a research turn that already has a deadline.
    mode: "fast",
    max_chars_total: PARALLEL_CHARS_TOTAL,
    advanced_settings: {
      max_results: PARALLEL_MAX_RESULTS,
      excerpt_settings: { max_chars_per_result: PARALLEL_CHARS_PER_RESULT },
    },
  };
}

/**
 * Results from one search, ready to become sources.
 *
 * `excerpts` is joined with a space: the API returns them as separate strings
 * for the same page, and the model reads a paragraph better than a list of
 * fragments. Whitespace is collapsed because excerpt boundaries are arbitrary
 * and produce doubled newlines otherwise.
 */
export function parallelResults(
  payload: ParallelPayload,
  limit = PARALLEL_MAX_RESULTS,
): { title: string; url: string; snippet?: string }[] {
  const seen = new Set<string>();
  const hits: { title: string; url: string; snippet?: string }[] = [];

  for (const hit of payload.results ?? []) {
    const url = typeof hit?.url === "string" ? hit.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);

    const snippet = (hit.excerpts ?? [])
      .filter((e): e is string => typeof e === "string")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800);

    hits.push({
      title: hit.title?.trim() || "Untitled result",
      url,
      snippet: snippet || undefined,
    });
    if (hits.length >= limit) break;
  }

  return hits;
}
