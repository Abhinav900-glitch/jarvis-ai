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

export type DeckProvider = "gamma" | "presentations" | "presenton" | "none";
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

// ---------------------------------------------------------------------------
// Presenton — open-source decks, self-hosted or cloud.
//
// Presenton ships two API generations that differ in exactly the places that
// break a naive client: the cloud service speaks `/api/v3/presentation/…` and
// calls the template field `standard_template`, while a self-hosted instance
// speaks `/api/v1/ppt/presentation/…` and calls it `template`. The base URL is
// therefore the switch, and both endpoints are derived rather than configured
// separately so a mismatch is impossible.
//
// Generation is used in its async form: a deck takes one to two minutes, which
// is longer than an action should hold a connection open, and the panel is
// already polling.
// ---------------------------------------------------------------------------

export interface PresentonEndpoints {
  /** POST target that starts the deck. */
  generate: string;
  /** GET target that reports on it, by task id. */
  status: (id: string) => string;
  /** Which template key this API generation expects. */
  templateKey: "template" | "standard_template";
  /** Origin the returned paths belong to, for making them absolute. */
  origin: string;
}

export const PRESENTON_CLOUD = "https://api.presenton.ai";

export function presentonEndpoints(
  baseUrl?: string | null,
): PresentonEndpoints {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "") || PRESENTON_CLOUD;
  const cloud = /(^|\/\/)api\.presenton\.ai$/i.test(base);
  return {
    generate: cloud
      ? `${base}/api/v3/presentation/generate/async`
      : `${base}/api/v1/ppt/presentation/generate/async`,
    status: (id: string) =>
      cloud
        ? `${base}/api/v3/async-task/status/${encodeURIComponent(id)}`
        : `${base}/api/v1/ppt/presentation/status/${encodeURIComponent(id)}`,
    templateKey: cloud ? "standard_template" : "template",
    origin: cloud ? PRESENTON_CLOUD : base,
  };
}

/** Presenton returns paths relative to the instance that made the deck. */
export function absolutizeUrl(
  url: unknown,
  base: string,
): string | null {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return null;
  }
}

/**
 * Presenton's task body — the same shape for the create (202) response and for
 * the status endpoint, where the deck itself arrives under `data`.
 */
export function parsePresentonTask(
  payload: unknown,
  base: string,
): Partial<DeckJob> {
  const body = record(payload);
  const data = record(body.data ?? body.result ?? body.presentation);
  const downloadUrl = absolutizeUrl(data.path, base);
  const editUrl = absolutizeUrl(data.edit_path, base);
  return {
    generationId:
      str(body.id) ||
      str(body.task_id) ||
      str(data.presentation_id) ||
      null,
    status: normalizeDeckStatus(body.status),
    // The editor is the viewable artefact; the file is the download.
    url: editUrl ?? downloadUrl,
    exportUrl: downloadUrl,
    statusUrl: null,
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
