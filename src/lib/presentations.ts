// ---------------------------------------------------------------------------
// Presentation generation — Gamma and Presentations.AI.
//
// Both providers are asynchronous in the same way and different in every detail:
//
//   Gamma            POST public-api.gamma.app/v1.0/generations
//                    header `X-API-KEY`, {inputText, textMode, format, numCards}
//                    → {generationId}; GET /generations/{id}
//                    → {status, gammaUrl, exportUrl, credits}
//
//   Presentations.AI POST api.presentations.ai/api/v1/decks
//                    header `Authorization: Bearer`, `Request-Id`, `Prefer: wait=180`
//                    → 201 finished, or 202 + {status, status_url, deck_url, export}
//
// The status vocabularies differ too (`pending`, `COMPLETED`, `FAILED`,
// `IN_PROGRESS`), and the URLs arrive under at least three different key names
// depending on which endpoint answered. Normalising here keeps the Convex
// actions and the panel on one vocabulary, and makes the fall-backs testable
// without either provider's key.
// ---------------------------------------------------------------------------

export type DeckProvider = "gamma" | "presentations" | "none";
export type DeckStatus = "pending" | "completed" | "failed" | "none";

export interface DeckJob {
  provider: DeckProvider;
  /** Gamma's generation id, or Presentations.AI's Request-Id. */
  generationId: string | null;
  status: DeckStatus;
  /** Where a human opens the deck. */
  url: string | null;
  /** Direct download, when the provider prepared an export. */
  exportUrl: string | null;
  /** Poll target for providers that hand one back. */
  statusUrl: string | null;
  error: string | null;
}

/** Every status spelling the two providers use, folded into three states. */
export function normalizeDeckStatus(raw: unknown): DeckStatus {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return "none";
  if (
    value === "completed" ||
    value === "complete" ||
    value === "succeeded" ||
    value === "success" ||
    value === "done"
  ) {
    return "completed";
  }
  if (
    value === "failed" ||
    value === "failure" ||
    value === "error" ||
    value === "cancelled" ||
    value === "canceled"
  ) {
    return "failed";
  }
  // pending / queued / running / in_progress / processing all mean "poll again".
  return "pending";
}

const str = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Gamma's GET /generations/{id}. */
export function parseGammaStatus(payload: unknown): Partial<DeckJob> {
  const body = record(payload);
  return {
    status: normalizeDeckStatus(body.status),
    url: str(body.gammaUrl) || str(body.gamma_url) || null,
    exportUrl: str(body.exportUrl) || str(body.export_url) || null,
  };
}

/**
 * Presentations.AI's deck body — the same shape for the 201/202 create response
 * and for the polled status, with the export nested one level down.
 */
export function parsePresentationsDeck(payload: unknown): Partial<DeckJob> {
  const body = record(payload);
  const nested = record(body.export);
  const exportUrl =
    str(nested.download_url) ||
    str(nested.downloadUrl) ||
    str(body.download_url) ||
    null;
  const id = str(body.id) || str(body.deck_id) || str(body.request_id) || null;
  return {
    generationId: id,
    status: normalizeDeckStatus(body.status),
    url: str(body.deck_url) || str(body.deckUrl) || str(body.url) || null,
    exportUrl,
    statusUrl: str(body.status_url) || str(body.statusUrl) || null,
  };
}

/**
 * A prompt built from what the user typed.
 *
 * Both providers read long text, but a chat message is not a brief: the deck
 * inherits the structure it is given, so the instruction is prepended and the
 * text capped well under either provider's limit.
 */
export function deckPrompt(text: string, maxChars = 12_000): string {
  const body = text.trim().slice(0, maxChars);
  return `Turn the following into a clear, well-structured presentation. Keep the author's facts and figures; write slide-sized points rather than paragraphs.\n\n${body}`;
}
