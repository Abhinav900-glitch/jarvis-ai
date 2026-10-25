/**
 * End-to-end encryption for the text you type.
 *
 * The rule this module exists to enforce: **your words are ciphertext at
 * rest, the model's replies are not.**
 *
 * That split is not arbitrary. An assistant has to read your message to
 * answer it, so a reply can never be secret from the model that wrote it —
 * and it was never yours to hide in the first place. What *can* be hidden
 * is what you typed: the server stores it encrypted, and the only thing that
 * can open it lives in this browser, derived from a passphrase you choose.
 *
 * The key is derived with PBKDF2-SHA256 (310k rounds, the OWASP figure for
 * 2023+) and used as AES-GCM-256, which gives us authentication as well as
 * confidentiality: a tampered message fails to decrypt rather than silently
 * rendering as garbage.
 *
 * Keys are held **in memory only** — never localStorage, never a cookie, never
 * sent anywhere. That is deliberate: a stored key would be readable by any
 * script on the page, which would make the encryption decorative. The cost is
 * honest and visible instead: reload the tab and you re-enter your passphrase.
 *
 * This file is also imported by Convex code (`chats.ts`) for `isCiphertext`,
 * so nothing at module scope may touch `crypto`, `window`, or `localStorage`.
 */

/** PBKDF2 iterations. OWASP's 2023 recommendation for PBKDF2-HMAC-SHA256. */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const KEY_BITS = 256;

/**
 * Self-describing ciphertext prefix. A version tag, not decoration: it lets
 * the server distinguish "encrypted" from "plaintext" without a key, and lets
 * a future format bump coexist with rows written under the old one.
 */
export const CIPHER_PREFIX = "e2e1.";

/** Plaintext the key must be able to open, to prove a passphrase is right. */
const VERIFIER_TEXT = "jarvis-e2e-verifier-v1";

export const MIN_PASSPHRASE_LENGTH = 8;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Shape check only — does this string look like ciphertext produced here?
 *
 * Deliberately pure and dependency-free: Convex runs it on every write to
 * enforce that a user-authored message never lands in the database in the
 * clear, and it must not need WebCrypto or a key to answer.
 */
export function isCiphertext(value: string): boolean {
  if (typeof value !== "string" || !value.startsWith(CIPHER_PREFIX)) return false;
  const body = value.slice(CIPHER_PREFIX.length);
  // AES-GCM appends a 16-byte tag to the plaintext, and this format prefixes a
  // 12-byte nonce — so the shortest value that can ever be produced is 28
  // bytes, which base64s to exactly 40 characters. "hi" encrypts to that, and
  // a floor set any higher would make the server refuse the user's own two
  // letter message as "not encrypted".
  if (body.length < 40) return false;
  if (body.length % 4 !== 0) return false;
  return BASE64.test(body);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A fresh random salt, base64. One per user, stored server-side (it is not secret). */
export function newSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

/**
 * Derive the AES key from a passphrase.
 *
 * The passphrase itself never leaves this function and never reaches the
 * network — only the derived key and the public salt are used afterwards.
 */
export async function deriveKey(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(saltBase64) as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt text. Returns `e2e1.<base64 of nonce||ciphertext>`. */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const joined = new Uint8Array(nonce.length + body.length);
  joined.set(nonce, 0);
  joined.set(body, nonce.length);
  return CIPHER_PREFIX + toBase64(joined);
}

/**
 * Decrypt a value written by `encryptText`.
 *
 * Throws on anything it did not encrypt: wrong key, truncated blob, or a
 * message someone edited in place. GCM authenticates, so none of those can
 * be coerced into plausible-looking output.
 */
export async function decryptText(key: CryptoKey, blob: string): Promise<string> {
  if (!isCiphertext(blob)) throw new Error("Value is not encrypted.");
  const joined = fromBase64(blob.slice(CIPHER_PREFIX.length));
  if (joined.length <= NONCE_BYTES) throw new Error("Encrypted value is truncated.");
  const nonce = joined.subarray(0, NONCE_BYTES);
  const body = joined.subarray(NONCE_BYTES);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as unknown as BufferSource },
    key,
    body as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Decrypt only what is actually ciphertext, leaving plaintext alone.
 *
 * Every row written before this feature existed is plaintext, and some rows
 * (the model's replies) always will be. A value that fails to decrypt is
 * returned untouched rather than thrown — one unreadable row must never blank
 * a whole conversation.
 */
export async function decryptMaybe(
  key: CryptoKey | null,
  value: string,
): Promise<string> {
  if (!key || !isCiphertext(value)) return value;
  try {
    return await decryptText(key, value);
  } catch {
    return value;
  }
}

/** A ciphertext the key must be able to open, so a later attempt can be checked. */
export async function makeVerifier(key: CryptoKey): Promise<string> {
  return encryptText(key, VERIFIER_TEXT);
}

/** Does this passphrase open this stored verifier? Wrong answers return false. */
export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return (await decryptText(key, verifier)) === VERIFIER_TEXT;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The unlocked key — memory only, shared across the app
// ---------------------------------------------------------------------------

type KeyState = { salt: string; key: CryptoKey } | null;

let state: KeyState = null;
let revision = 0;
const listeners = new Set<() => void>();

function notify(): void {
  revision++;
  for (const listener of listeners) listener();
}

/**
 * Derive and hold the key for this tab.
 *
 * The salt is part of the identity of the key: a passphrase re-derived against
 * a different salt is a different key, so refusing to reuse a cached one when
 * the salt moves stops the wrong key from being silently applied.
 */
export async function unlockKey(passphrase: string, saltBase64: string): Promise<CryptoKey> {
  const key = await deriveKey(passphrase, saltBase64);
  state = { salt: saltBase64, key };
  notify();
  return key;
}

/** Forget the key. Called on sign-out and whenever the user asks to lock. */
export function lockKey(): void {
  if (state === null) return;
  state = null;
  notify();
}

/** The unlocked key, but only if it belongs to this salt. */
export function currentKey(salt: string | undefined | null): CryptoKey | null {
  if (!state || !salt || state.salt !== salt) return null;
  return state.key;
}

export function isUnlocked(salt: string | undefined | null): boolean {
  return currentKey(salt) !== null;
}

/** Subscribe to lock/unlock changes. Returns an unsubscribe function. */
export function subscribeToKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic counter, so `useSyncExternalStore` sees a change on every unlock. */
export function keyRevision(): number {
  return revision;
}

// ---------------------------------------------------------------------------
// Plaintext cache — memory only, and only for values we encrypted ourselves
// ---------------------------------------------------------------------------

/**
 * Ciphertext → plaintext, for values this tab just wrote.
 *
 * Decryption is asynchronous, and the transcript re-renders the instant a new
 * message lands. Without somewhere to look up synchronously, your own message
 * would flash in as an empty bubble and fill itself a beat later. Seeding the
 * cache at write time means the row you sent is readable on the very render
 * that shows it, while everything older is filled in by the decrypt pass.
 *
 * Cleared with everything else on lock or reload: it lives in memory and
 * nowhere else, exactly like the key that would open it.
 */
const plainCache = new Map<string, string>();
const PLAIN_CACHE_LIMIT = 500;

export function rememberPlaintext(ciphertext: string, plaintext: string): void {
  if (plainCache.size >= PLAIN_CACHE_LIMIT) plainCache.clear();
  plainCache.set(ciphertext, plaintext);
}

export function peekPlaintext(ciphertext: string): string | undefined {
  return plainCache.get(ciphertext);
}

export function forgetPlaintext(): void {
  plainCache.clear();
}

/** Locking drops both the key and everything this key had opened in memory. */
export function lockEverything(): void {
  lockKey();
  forgetPlaintext();
}
