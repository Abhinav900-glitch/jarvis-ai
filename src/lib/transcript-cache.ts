// ---------------------------------------------------------------------------
// The last conversation, kept on this device.
//
// Convex keeps its query cache in memory, so a reload with no connection loses
// the transcript entirely. This module stores the one chat most recently read
// — decrypted text only, never ciphertext, never a second chat — so the screen
// can show it read-only while the network is gone.
//
// One slot, deliberately: "the last chat you read" is a promise the UI can keep
// without turning into an unmanaged local archive of everything ever discussed.
// The snapshot is bounded (message count and characters), and the app clears it
// on sign-out or when the reader chooses "Forget".
// ---------------------------------------------------------------------------

const STORAGE_KEY = "jarvis-offline-transcript";
const VERSION = 1;
const MAX_MESSAGES = 80;
const MAX_CHARS = 160_000;

export interface CachedTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  imageUrl?: string;
  images?: string[];
}

export interface CachedTranscript {
  version: number;
  sessionId: string;
  title: string;
  savedAt: number;
  messages: CachedTranscriptMessage[];
}

/** What the chat screen hands over; ids stay strings, the cache is not Convex. */
export interface TranscriptSourceMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  imageUrl?: string;
  images?: string[];
}

function isMessage(value: unknown): value is CachedTranscriptMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<CachedTranscriptMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.createdAt === "number"
  );
}

function normalise(messages: CachedTranscriptMessage[]): CachedTranscriptMessage[] {
  // Read backwards so the newest tail of a long chat is what survives, then
  // restore reading order. Empty turns carry nothing to read; drop them so a
  // decrypt-in-progress snapshot cannot blank out an older, whole one.
  const kept: CachedTranscriptMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const content = message.content;
    const hasImage = Boolean(message.imageUrl) || (message.images?.length ?? 0) > 0;
    if (content.trim().length === 0 && !hasImage) continue;
    if (kept.length >= MAX_MESSAGES) break;
    if (chars > 0 && chars + content.length > MAX_CHARS) continue;
    kept.push(message);
    chars += content.length;
    if (chars >= MAX_CHARS) break;
  }
  return kept.reverse();
}

export function readCachedTranscript(): CachedTranscript | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<CachedTranscript>;
    if (
      parsed.version !== VERSION ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length === 0 ||
      !Array.isArray(parsed.messages)
    ) {
      return null;
    }
    const messages = normalise(parsed.messages.filter(isMessage));
    if (messages.length === 0) return null;
    return {
      version: VERSION,
      sessionId: parsed.sessionId,
      title: typeof parsed.title === "string" ? parsed.title : "",
      savedAt:
        typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
      messages,
    };
  } catch {
    // Corrupt or from an older format: showing half a transcript is worse than
    // showing none.
    return null;
  }
}

export function saveTranscript(
  sessionId: string,
  title: string,
  messages: readonly TranscriptSourceMessage[],
): CachedTranscript | null {
  const snapshot: CachedTranscript = {
    version: VERSION,
    sessionId,
    title,
    savedAt: Date.now(),
    messages: normalise(messages.map((message) => ({ ...message }))),
  };
  if (snapshot.messages.length === 0) return null;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot;
  } catch {
    // Quota or a blocked store: try once without the older half, because a
    // shorter recent tail is more useful offline than nothing at all.
    const tail = normalise(snapshot.messages.slice(-Math.floor(MAX_MESSAGES / 2)));
    if (tail.length === 0) return null;
    const shorter = { ...snapshot, messages: tail };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(shorter));
      return shorter;
    } catch {
      return null;
    }
  }
}

export function clearCachedTranscript(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: a future read will find whatever is there.
  }
}
