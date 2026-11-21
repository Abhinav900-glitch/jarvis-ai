// ---------------------------------------------------------------------------
// The offline outbox.
//
// One message, stored on this device, for the moment the network is gone: the
// assistant itself runs on the server, so a reply cannot be produced offline —
// but the question does not have to be lost. The chat screen writes here when
// the user presses Send with no connection, and sends it by itself when the
// connection is back and that same chat is open.
//
// A single slot rather than a queue: an offline conversation cannot be answered
// in order, and silently accumulating half a dozen turns to fire at once would
// read as the app talking to itself. One clear "waiting to send" is honest.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "jarvis-offline-outbox";

export interface OutboxMessage {
  text: string;
  /** The chat it was typed in; null when it was a new, unsaved chat. */
  sessionId: string | null;
  savedAt: number;
}

export function readOutbox(): OutboxMessage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OutboxMessage>;
    if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) {
      return null;
    }
    return {
      text: parsed.text,
      sessionId:
        typeof parsed.sessionId === "string" && parsed.sessionId.length > 0
          ? parsed.sessionId
          : null,
      savedAt:
        typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    // Corrupt JSON or blocked storage: no outbox is better than a crash.
    return null;
  }
}

export function writeOutbox(message: OutboxMessage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Private mode still gets the in-memory copy the screen keeps.
  }
}

export function clearOutbox(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the next read simply won't find a stored message.
  }
}
