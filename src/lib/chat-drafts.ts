// ---------------------------------------------------------------------------
// Per-conversation drafts.
//
// Kept in localStorage rather than in the chat row: a draft is unsent text, and
// writing half-typed sentences to the database — where every read path would
// have to filter them out — solves nothing. One key per conversation, cleared
// as soon as the text is sent, so switching chats, reloading, or following a
// citation into another tab does not lose the paragraph you were writing.
//
// Every function tolerates a storage that throws (Safari private mode, a
// blocked third-party context): a lost draft is a nuisance, an exception in the
// composer is a broken app.
// ---------------------------------------------------------------------------

const PREFIX = "jarvis-draft:";
/** The composer before a conversation exists. */
export const NEW_CHAT_DRAFT_KEY = `${PREFIX}new`;

export function draftKeyFor(sessionId: string | null | undefined): string {
  return sessionId ? `${PREFIX}${sessionId}` : NEW_CHAT_DRAFT_KEY;
}

export function loadDraft(
  key: string,
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): string {
  try {
    return storage?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(
  key: string,
  text: string,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage(),
): void {
  // Whitespace-only is not a draft: it would restore as a blank composer that
  // looks loaded and save nothing.
  const value = text.trim() ? text : "";
  try {
    if (value) storage?.setItem(key, value);
    else storage?.removeItem(key);
  } catch {
    /* storage full or refused — the composer keeps working */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
