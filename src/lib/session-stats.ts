/**
 * Session statistics, computed from the messages already on screen.
 *
 * Deliberately pure and synchronous: every input is a field the transcript has
 * loaded anyway, so the dialog can open instantly instead of paying for a
 * query — and the whole calculation is testable without a Convex runtime.
 *
 * Only the *visible branch* counts. A chat's stats should describe what the
 * user is looking at, not every fork that exists in the database, otherwise
 * the numbers disagree with the transcript beside them.
 */

export interface StatsMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  /** `provider/model` that produced an assistant reply, when known. */
  engineId?: string | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  latencyMs?: number | undefined;
  /** The user's thumbs verdict on an assistant reply, when they left one. */
  feedback?: "up" | "down" | undefined;
}

export interface EngineStat {
  id: string;
  /** How many replies this engine produced in the session. */
  replies: number;
}

export interface SessionStats {
  messages: number;
  userMessages: number;
  replies: number;
  /** Words across every message — the crudest honest length measure. */
  words: number;
  promptTokens: number;
  completionTokens: number;
  /** Engines by reply count, most-used first. */
  engines: EngineStat[];
  /** Thumbs ratings left on replies. */
  feedbackUp: number;
  feedbackDown: number;
  /** Mean time-to-first-token over the replies that reported one, or null. */
  avgLatencyMs: number | null;
  firstAt: number | null;
  lastAt: number | null;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function sessionStats(messages: StatsMessage[]): SessionStats {
  const engines = new Map<string, number>();
  let userMessages = 0;
  let replies = 0;
  let words = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let feedbackUp = 0;
  let feedbackDown = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;

  for (const m of messages) {
    if (m.role === "user") userMessages += 1;
    if (m.role === "assistant") {
      replies += 1;
      if (m.engineId) engines.set(m.engineId, (engines.get(m.engineId) ?? 0) + 1);
      if (typeof m.latencyMs === "number" && m.latencyMs >= 0) {
        latencySum += m.latencyMs;
        latencyCount += 1;
      }
      if (m.feedback === "up") feedbackUp += 1;
      if (m.feedback === "down") feedbackDown += 1;
    }
    words += countWords(m.content);
    promptTokens += m.promptTokens ?? 0;
    completionTokens += m.completionTokens ?? 0;
    firstAt = firstAt === null ? m.createdAt : Math.min(firstAt, m.createdAt);
    lastAt = lastAt === null ? m.createdAt : Math.max(lastAt, m.createdAt);
  }

  return {
    messages: messages.length,
    userMessages,
    replies,
    words,
    promptTokens,
    completionTokens,
    engines: [...engines.entries()]
      .map(([id, replies]) => ({ id, replies }))
      .sort((a, b) => b.replies - a.replies || a.id.localeCompare(b.id)),
    feedbackUp,
    feedbackDown,
    avgLatencyMs:
      latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
    firstAt,
    lastAt,
  };
}

/** The engine label without its `provider/` prefix, for compact display. */
export function engineLabel(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}


