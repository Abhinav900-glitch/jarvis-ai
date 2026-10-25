/**
 * The contracts the chat-encryption feature lives or dies by.
 *
 * Two things are being pinned here: that ciphertext really is opaque to
 * anyone without the key, and — the one the server leans on — that the shape
 * check in `isCiphertext` correctly separates an encrypted turn from a
 * plaintext one. If that check ever accepts plain text, the Convex guard that
 * stops user words being stored in the clear stops working with it.
 */
import { describe, expect, test } from "bun:test";
import {
  CIPHER_PREFIX,
  MIN_PASSPHRASE_LENGTH,
  checkVerifier,
  currentKey,
  decryptMaybe,
  decryptText,
  deriveKey,
  encryptText,
  isCiphertext,
  isUnlocked,
  lockKey,
  makeVerifier,
  newSalt,
} from "../e2e";

const PASSPHRASE = "correct horse battery staple";

async function keyFor(passphrase = PASSPHRASE) {
  return deriveKey(passphrase, newSalt());
}

describe("isCiphertext", () => {
  test("recognises a value this module produced", async () => {
    const blob = await encryptText(await keyFor(), "hello world");
    expect(blob.startsWith(CIPHER_PREFIX)).toBe(true);
    expect(isCiphertext(blob)).toBe(true);
  });

  test("rejects plain text — this is the guard the server depends on", () => {
    expect(isCiphertext("my secret message")).toBe(false);
    expect(isCiphertext("")).toBe(false);
    expect(isCiphertext("New chat")).toBe(false);
    // Long enough to be plausible, but not ours.
    expect(isCiphertext("a".repeat(400))).toBe(false);
  });

  test("rejects a malformed body", () => {
    expect(isCiphertext(CIPHER_PREFIX + "!!!!not base64!!!!")).toBe(false);
    expect(isCiphertext(CIPHER_PREFIX)).toBe(false);
    expect(isCiphertext(CIPHER_PREFIX + "AAAA")).toBe(false);
  });

  test("accepts the shortest message the module can produce", async () => {
    // "hi" is a real message a user will send, and it reaches the server as
    // the minimum-length blob. The shape check has to let it through — a
    // floor set any higher makes the server refuse your own two-letter turn.
    expect(isCiphertext(await encryptText(await keyFor(), "hi"))).toBe(true);
    expect(isCiphertext(await encryptText(await keyFor(), ""))).toBe(true);
  });
});

describe("encrypt / decrypt", () => {
  test("round-trips through the same key", async () => {
    const key = await keyFor();
    const message = "meet me at the docks at midnight ⚓";
    expect(await decryptText(key, await encryptText(key, message))).toBe(
      message,
    );
  });

  test("produces different ciphertext every time (fresh nonce)", async () => {
    const key = await keyFor();
    const a = await encryptText(key, "same words");
    const b = await encryptText(key, "same words");
    expect(a).not.toBe(b);
    expect(await decryptText(key, a)).toBe(await decryptText(key, b));
  });

  test("a wrong passphrase cannot open it", async () => {
    const blob = await encryptText(await keyFor(), "the treasure is buried");
    const wrong = await keyFor("not the passphrase");
    await expect(decryptText(wrong, blob)).rejects.toThrow();
  });

  test("a different salt means a different key", async () => {
    const one = await deriveKey(PASSPHRASE, newSalt());
    const two = await deriveKey(PASSPHRASE, newSalt());
    const blob = await encryptText(one, "only one of me");
    await expect(decryptText(two, blob)).rejects.toThrow();
  });

  test("a truncated blob is caught by authentication, not by its shape", async () => {
    const key = await keyFor();
    const blob = await encryptText(key, "too short to be complete");
    // Length alone cannot prove a blob is intact — that is what the GCM tag is
    // for, which is why `isCiphertext` only checks the shape.
    const truncated = blob.slice(0, blob.length - 4);
    expect(isCiphertext(truncated)).toBe(true);
    await expect(decryptText(key, truncated)).rejects.toThrow();
  });

  test("tampering with the bytes breaks authentication rather than decoding", async () => {
    const key = await keyFor();
    const blob = await encryptText(key, "integrity matters");
    const body = blob.slice(CIPHER_PREFIX.length);
    const raw = Buffer.from(body, "base64");
    raw[raw.length - 1] ^= 0xff;
    const tampered =
      CIPHER_PREFIX + Buffer.from(raw).toString("base64");
    await expect(decryptText(key, tampered)).rejects.toThrow();
  });

  test("handles empty strings and unicode", async () => {
    const key = await keyFor();
    for (const value of ["", "こんにちは", "🔐 emoji + newline\n"]) {
      expect(await decryptText(key, await encryptText(key, value))).toBe(value);
    }
  });
});

describe("decryptMaybe", () => {
  test("returns plaintext untouched when no key is available", async () => {
    expect(await decryptMaybe(null, "a plain assistant reply")).toBe(
      "a plain assistant reply",
    );
  });

  test("decrypts what it can and passes through what it cannot", async () => {
    const key = await keyFor();
    const blob = await encryptText(key, "mine");
    expect(await decryptMaybe(key, blob)).toBe("mine");
    // A row written before this feature existed must not blank the chat.
    expect(await decryptMaybe(key, "written in the clear")).toBe(
      "written in the clear",
    );
    // Nor may an unreadable row throw and take the transcript with it.
    expect(await decryptMaybe(key, CIPHER_PREFIX + "AAAAAAAA")).toBe(
      CIPHER_PREFIX + "AAAAAAAA",
    );
  });
});

describe("verifier", () => {
  test("proves the right passphrase without storing it", async () => {
    const key = await keyFor();
    const verifier = await makeVerifier(key);
    expect(isCiphertext(verifier)).toBe(true);
    expect(await checkVerifier(key, verifier)).toBe(true);
  });

  test("rejects a wrong passphrase", async () => {
    const verifier = await makeVerifier(await keyFor());
    const wrong = await keyFor("still not it");
    expect(await checkVerifier(wrong, verifier)).toBe(false);
  });

  test("rejects a verifier that is not ours", async () => {
    const key = await keyFor();
    expect(await checkVerifier(key, "not encrypted at all")).toBe(false);
    expect(await checkVerifier(key, CIPHER_PREFIX + "AAAA")).toBe(false);
  });
});

describe("unlock / lock", () => {
  test("holds the key for the matching salt only", async () => {
    const salt = newSalt();
    const key = await keyFor();
    const { unlockKey } = await import("../e2e");
    await unlockKey(PASSPHRASE, salt);
    expect(isUnlocked(salt)).toBe(true);
    expect(currentKey(salt)).not.toBeNull();
    // A different salt is a different account's key — refuse it.
    expect(currentKey(newSalt())).toBeNull();
    expect(isUnlocked(undefined)).toBe(false);
    lockKey();
    expect(isUnlocked(salt)).toBe(false);
  });
});

describe("policy", () => {
  test("passphrase floor is not trivially short", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBeGreaterThanOrEqual(8);
  });

  test("a salt is a usable base64 string", () => {
    const salt = newSalt();
    expect(typeof salt).toBe("string");
    expect(Buffer.from(salt, "base64").length).toBeGreaterThanOrEqual(16);
  });
});
