// ---------------------------------------------------------------------------
// spaCy — the parser half of the NLP layer.
//
// spaCy is Python-only (compiled extensions and Python-language model packages),
// so a Convex action cannot run it in-process. What it can do is speak HTTP to a
// small wrapper the operator runs:
//
//     POST $SPACY_API_URL   { "text": "…" }
//     → { "lang": "en",
//         "sentences": ["…", "…"],
//         "tokens": [{ "text": "Paris", "pos": "PROPN", "tag": "NNP", "lemma": "Paris" }],
//         "entities": [{ "text": "Paris", "label": "GPE", "start": 0, "end": 5 }] }
//
// That is the natural shape of `doc.sents`, `[t.pos_ …]` and `doc.ents` from
// `spacy.load("en_core_web_sm")`, so the wrapper is a dozen lines of FastAPI.
// Unlike GLiNER there is no canonical route, so the URL is used exactly as
// given — the operator points it at whatever path their service serves.
//
// A self-hosted wrapper may be terse (`pos_`/`tag_`, `ents`, counts instead of
// lists), so the parser accepts both spellings and never throws: a panel with
// partial syntax beats a failed analysis.
// ---------------------------------------------------------------------------

export interface SpacySyntax {
  /** Sentence count, when the service reported sentences. */
  sentences: number | null;
  /** Token count, when it reported tokens. */
  tokens: number | null;
  /** Most common universal POS tags, strongest first. */
  pos: { tag: string; count: number }[];
}

export interface SpacyAnalysis {
  /** Language code from the model, or null when it did not say. */
  lang: string | null;
  syntax: SpacySyntax;
  entities: { text: string; label: string }[];
}

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/**
 * The endpoint to POST to, used as configured.
 *
 * Only normalisation is trailing whitespace and slashes — a spaCy wrapper can
 * serve `/analyze`, `/nlp`, `/api/nlp`, or the root, and guessing a suffix would
 * break the ones that do not match.
 */
export function spacyEndpoint(url: string | null | undefined): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/**
 * Normalise a spaCy wrapper's response.
 *
 * `pos` is folded into a histogram because that is what the panel shows; the
 * raw token list would be hundreds of rows for a paragraph.
 */
export function parseSpacyAnalysis(payload: unknown): SpacyAnalysis {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};

  const lang =
    str(record.lang) || str(record.language) || str(record.language_code) || null;

  const sentences = asArray(record.sentences ?? record.sents);
  const tokens = asArray(record.tokens ?? record.words);
  const entities = asArray(record.entities ?? record.ents);

  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (!token || typeof token !== "object") continue;
    const t = token as Record<string, unknown>;
    const tag = (str(t.pos) || str(t.pos_) || str(t.tag) || str(t.tag_)).toUpperCase();
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return {
    lang: lang && lang.length <= 12 ? lang.toLowerCase() : null,
    syntax: {
      sentences: num(record.sentence_count) ?? (sentences.length || null),
      tokens: num(record.token_count) ?? (tokens.length || null),
      pos: [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    },
    entities: entities
      .map((entity) => {
        if (!entity || typeof entity !== "object") return null;
        const e = entity as Record<string, unknown>;
        const text = str(e.text) || str(e.text_);
        if (!text) return null;
        return {
          text,
          label: (str(e.label) || str(e.label_) || str(e.entity_type) || "entity")
            .toLowerCase()
            .slice(0, 40),
        };
      })
      .filter((entity): entity is { text: string; label: string } => entity !== null)
      .slice(0, 40),
  };
}
