import { Phone } from "@convex-dev/auth/providers/Phone";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";
import { sendSentWhatsappText, sentWhatsAppReady } from "../../lib/sent";

/**
 * WhatsApp OTP sign-in.
 *
 * The Phone provider gives Convex Auth the same six-digit challenge shape as
 * the email provider, but delivers it through Sent's WhatsApp channel. A user
 * only needs a mobile number with a country code, which is the point of
 * "Continue with WhatsApp" on the auth page.
 *
 * Sent must have a configured WhatsApp channel. An authentication message is
 * business-initiated, so Meta also requires an approved authentication template
 * for numbers outside an open 24-hour window; the preflight below reports the
 * missing channel, and Sent reports a template block on delivery.
 */
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function normalizePhone(identifier: string): string {
  const compact = identifier.trim().replace(/[^\d+]/g, "");
  const normalized = compact.startsWith("+") ? compact : `+${compact}`;
  if (!PHONE_PATTERN.test(normalized)) {
    throw new Error(
      "Enter a mobile number with its country code, e.g. +14155550123.",
    );
  }
  return normalized;
}

export const whatsappOtp = Phone({
  id: "whatsapp-otp",
  maxAge: 60 * 10,
  normalizeIdentifier: normalizePhone,
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    return generateRandomString(random, "0123456789", 6);
  },
  async sendVerificationRequest({ identifier, token }) {
    const ready = await sentWhatsAppReady();
    if (!ready.ready) {
      throw new Error(ready.error ?? "WhatsApp is not ready to send codes.");
    }

    const result = await sendSentWhatsappText(
      normalizePhone(identifier),
      `Your Jarvis sign-in code is ${token}. It expires in 10 minutes. If you did not request it, ignore this message.`,
    );
    if (!result.ok) {
      throw new Error(
        `WhatsApp could not send the code: ${
          result.error ?? "Sent rejected the message"
        }`,
      );
    }
  },
});
