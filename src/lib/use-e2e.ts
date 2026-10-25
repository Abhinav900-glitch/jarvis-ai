/**
 * React binding for the in-memory encryption key.
 *
 * Kept out of `e2e.ts` on purpose: that module is imported by Convex, and
 * pulling React into a server-bundled file would break the deployment. This
 * side is browser-only.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  currentKey,
  decryptMaybe,
  isCiphertext,
  isUnlocked,
  keyRevision,
  lockKey,
  peekPlaintext,
  rememberPlaintext,
  subscribeToKey,
  unlockKey,
} from "./e2e";

/**
 * Re-renders whenever the key is unlocked, derived or dropped, and returns
 * the key for this salt — or `null` while locked.
 */
export function useE2EKey(salt: string | null | undefined) {
  useSyncExternalStore(subscribeToKey, keyRevision, keyRevision);
  return currentKey(salt);
}

/** Same, but as the boolean most UI branches actually want. */
export function useE2EUnlocked(salt: string | null | undefined): boolean {
  useSyncExternalStore(subscribeToKey, keyRevision, keyRevision);
  return isUnlocked(salt);
}

/**
 * Unlock for the current salt.
 *
 * Exposed through a hook so callers get a stable function identity — an
 * inline closure here would re-fire any effect that depends on it.
 */
export function useUnlockKey() {
  return useCallback(
    async (passphrase: string, salt: string) => unlockKey(passphrase, salt),
    [],
  );
}

export { lockKey };

/**
 * A function that renders any session's title in the clear, decrypting the
 * ones that are ciphertext.
 *
 * Chat titles are derived from your first message, so they are encrypted
 * along with it — which would otherwise fill the sidebar with base64. Like the
 * transcript, decryption is async while the sidebar wants to render now, so
 * the cache is filled in the background and a locked account sees a label
 * instead of an unreadable blob.
 */
export function useDecryptedTitles(
  sessions: { _id: string; title: string }[],
): (session: { _id: string; title: string }) => string {
  const material = useQuery(api.chats.keyMaterial);
  const key = currentKey(material?.salt);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) return;
    const pending = sessions.filter(
      (s) => isCiphertext(s.title) && peekPlaintext(s.title) === undefined,
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const s of pending) {
        const plain = await decryptMaybe(key, s.title);
        rememberPlaintext(s.title, plain);
      }
      if (!cancelled) setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, key]);

  return useCallback(
    (session: { _id: string; title: string }) => {
      if (!isCiphertext(session.title)) return session.title;
      if (!key) return "🔒 Encrypted chat";
      return peekPlaintext(session.title) ?? "…";
    },
    // tick is read deliberately: it refreshes the memoised-looking closure
    // once a background decrypt finishes.
    [key, tick],
  );
}
