/**
 * Finds the most likely one-time code in an SMS.
 *
 * Most OTPs are four to eight characters after a word like "code", "OTP",
 * "PIN" or "verification". The fallback catches a bare six-digit code, which is
 * the other common shape. It deliberately does not try to parse every
 * provider's wording: the caller gets the code or null, and the message stays
 * untouched.
 */
export function extractOtp(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  // A code directly after the word with a separator: "OTP-483920" or
  // "code: 483920". The digit lookahead keeps the word "code" itself from
  // being captured when the phrase is "verification code is ...".
  const adjacent = normalized.match(
    /\b(?:code|otp|pin|passcode|verification)\b[\s:-]+(?=[A-Z0-9]*\d)([A-Z0-9]{4,8})\b/i,
  );
  if (adjacent) return adjacent[1].toUpperCase();

  // The lookahead requires a digit, so the word "code" itself (or "here"
  // after "code") cannot be mistaken for the code. The code may be
  // alphanumeric, but it must contain at least one number.
  const keyword = normalized.match(
    /\b(?:code|otp|pin|passcode|verification)\b[\s\S]{0,32}?[^\d-](?=[A-Z0-9]*\d)([A-Z0-9]{4,8})\b/i,
  );
  if (keyword) return keyword[1].toUpperCase();

  // Google-style prefixed codes: "G-123456". The hyphen is part of the code,
  // so the generic bare-number path deliberately cannot catch it.
  const prefixed = normalized.match(/\b([A-Z]-\d{6})\b/i);
  if (prefixed) return prefixed[1].toUpperCase();

  // Codes that come before the word: "483920 is your verification code".
  const leading = normalized.match(
    /^(\d{4,8})\s+(?:is|was)\s+(?:your|the)\s+[\s\S]{0,40}\b(?:code|otp|pin|passcode|verification)\b/i,
  );
  if (leading) return leading[1];

  // A bare code as the whole message: "483920" or "(483920)". Digits inside
  // an order number, phone number or ordinary sentence are not treated as a
  // code without a keyword.
  const bare = normalized.match(/^[^\w]*(\d{4,8})[^\w]*$/);
  return bare ? bare[1] : null;
}
