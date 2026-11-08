// ---------------------------------------------------------------------------
// GLiNER — the entity half of the NLP layer.
//
// GLiNER is a Python library (urchade/GLiNER) and there is no maintained JS
// port, so it is not something a Convex action can import. What it does have is
// a documented HTTP service — `python -m gliner.serve --model …` — that answers
// `POST /gliner` with `{ text, labels, threshold }` and returns
// `{ entities: [{ start, end, text, label, score }] }`.
//
// So the integration point is that service, addressed by `GLINER_API_URL`. The
// helpers here keep the endpoint guessable (`https://host:8000` and
// `https://host:8000/gliner/` both work), read the labels, and normalise the
// payload — because a self-hosted endpoint may be a custom handler that returns
// a bare array or wraps the list differently. Normalising here means the action
// has one shape to deal with.
// ---------------------------------------------------------------------------

export interface GlinerEntity {
  text: string;
  label: string;
  score: number;
  start: number | null;
  end: number | null;
}

/**
 * The labels asked for by default.
 *
 * Zero-shot NER is only as good as the label list: a type not named here cannot
 * come back, which is why the list leans on the things a chat assistant is
 * actually asked about rather than the four classical CoNLL types.
 */
export const GLINER_DEFAULT_LABELS = [
  "person",
  "organization",
  "location",
  "date",
  "product",
  "event",
  "money",
  "technology",
];

/** `GLINER_LABELS=a,b,c` overrides the defaults; empty entries are dropped. */
export function glinerLabels(raw?: string | null): string[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed.slice(0, 60) : GLINER_DEFAULT_LABELS;
}

/**
 * The full `/gliner` URL for a configured base.
 *
 * Accepts `https://host`, `https://host/`, `https://host/gliner` and
 * `https://host/gliner/` — the route prefix is configurable on the server, so
 * a caller that already included it must not end up with `/gliner/gliner`.
 */
export function glinerEndpoint(url: string | null | undefined): string {
  const trimmed = (url ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/gliner$/i.test(trimmed) ? trimmed : `${trimmed}/gliner`;
}

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Normalise any plausible GLiNER response into entities.
 *
 * Accepts `{ entities: [...] }`, `{ results: [...] }`, a bare array, and —
 * defensively — a per-text array of those (`[{ entities: [...] }]`), which is
 * what a batched call returns. Anything unparseable yields an empty list rather
 * than throwing: an NLP panel with no entities is useful, a failed turn is not.
 */
export function parseGlinerEntities(payload: unknown): GlinerEntity[] {
  const rows = Array.isArray(payload) ? payload : [payload];
  // Keyed, not appended: a span can be proposed twice (overlapping windows, or
  // a handler that merges batches). The strongest reading of it survives.
  const byKey = new Map<string, GlinerEntity>();

  const push = (row: unknown) => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    const text = str(record.text);
    if (!text) return;
    const label = str(record.label) || str(record.entity_type) || "entity";
    const key = `${text.toLowerCase()}::${label.toLowerCase()}`;
    const next: GlinerEntity = {
      text,
      label,
      score: num(record.score) ?? 0,
      start: num(record.start),
      end: num(record.end),
    };
    const seen = byKey.get(key);
    if (!seen || next.score > seen.score) byKey.set(key, next);
  };

  for (const row of rows) {
    if (Array.isArray(row)) {
      row.forEach(push);
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const list = record.entities ?? record.results;
    if (Array.isArray(list)) {
      list.forEach(push);
      continue;
    }
    // A single entity object rather than a list of them.
    if ("text" in record) push(record);
  }

  return [...byKey.values()].sort((a, b) => b.score - a.score);
}
