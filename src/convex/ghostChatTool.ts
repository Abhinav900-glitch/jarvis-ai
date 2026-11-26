// ---------------------------------------------------------------------------
// The Ghost line chat tool.
//
// This is a built-in function tool, not an MCP server: the model can ask for
// the newest code on a temporary number and the chat loop answers from Temp
// Number directly. It is only attached to turns that look like they need it,
// so ordinary chat keeps its normal routing and cost.
// ---------------------------------------------------------------------------

import type { ToolSpec } from "./ai";
import {
  tempNumberRequest,
  type TempNumberInbox,
  type TempNumberMessage,
  type TempNumberNumber,
} from "../lib/temp-number";
import { extractOtp } from "../lib/otp";

export const GHOST_OTP_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "ghost_line_latest_otp",
    description:
      "Reads the newest SMS verification code (OTP) from the user's Ghost line temporary number. Use it when the user asks for an OTP, verification code, or what a temporary number just received. Omit line to use the newest active number; pass a phone number or its last four digits to choose one.",
    parameters: {
      type: "object",
      properties: {
        line: {
          type: "string",
          description:
            "Optional Ghost line phone number or last four digits. Omit for the newest active line.",
        },
      },
    },
  },
};

export const GHOST_OTP_PROMPT =
  "\n\nGhost line is available as the `ghost_line_latest_otp` tool. When the user asks for an OTP, verification code, or SMS from a temporary number, call it instead of asking them to paste the code or guessing. State which line the code came from.";

/**
 * Whether this turn is worth attaching the Ghost tool to.
 *
 * A named temporary-number product, OTP/SMS wording, or "latest code" is
 * enough. Generic code talk ("read this code", "review my code") is not: those
 * are ordinary coding turns and should keep the normal routing without an
 * extra tool schema.
 */
export function wantsGhostOtp(prompt: string): boolean {
  const ghostIntent =
    /\b(?:ghost\s*(?:line|number)|temp(?:orary)?\s*(?:number|phone|line)|burner|otp|one[-\s]?time\s*(?:code|password)|verification\s*code|verify\s*code|sms|text\s*message)\b/i;
  const latestCodeIntent =
    /\b(?:latest|recent|received?|just\s+got|waiting\s+for)\b[\s\S]{0,32}\b(?:code|pin)\b/i;
  return ghostIntent.test(prompt) || latestCodeIntent.test(prompt);
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDay(value: string): string {
  const time = timeOf(value);
  if (!time) return value || "unknown";
  return new Date(time).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatWhen(value: string): string {
  const time = timeOf(value);
  if (!time) return value || "unknown";
  return new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 400 ? `${clean.slice(0, 400)}…` : clean;
}

function readLineArgument(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const line = (parsed as Record<string, unknown>).line;
      if (typeof line === "string") return line.trim().slice(0, 40);
    }
  } catch {
    // A malformed argument becomes "use the newest line", not a failed turn.
  }
  return "";
}

function chooseLine(
  lines: TempNumberNumber[],
  wanted: string,
): TempNumberNumber | null {
  if (wanted) {
    const digits = wanted.replace(/\D/g, "");
    const byNumber = lines.find((line) => {
      const lineDigits = line.phone_number.replace(/\D/g, "");
      return (
        (digits.length >= 4 &&
          (lineDigits === digits || lineDigits.endsWith(digits))) ||
        line.phone_number.toLowerCase() === wanted.toLowerCase()
      );
    });
    if (byNumber) return byNumber;
    if (/^\d+$/.test(wanted)) {
      const byId = lines.find((line) => line.id === Number(wanted));
      if (byId) return byId;
    }
    return null;
  }
  return (
    [...lines].sort(
      (a, b) => timeOf(b.purchase_date) - timeOf(a.purchase_date),
    )[0] ?? null
  );
}

/**
 * Read the newest code, or the newest SMS when there is no code.
 *
 * Returns readable text in every case, including "no lines", "nothing yet" and
 * API failures. The chat loop feeds that text straight back to the model, so a
 * failed read is something Jarvis can explain rather than a dead turn.
 */
export async function readGhostOtp(rawArguments: string): Promise<string> {
  const wanted = readLineArgument(rawArguments);
  try {
    const listed = await tempNumberRequest<{ data?: unknown }>("/numbers");
    const lines = Array.isArray(listed.data)
      ? (listed.data as TempNumberNumber[])
      : [];
    if (lines.length === 0) {
      return "There are no Ghost lines on this account yet. Open Ghost line in the dashboard and buy one first.";
    }

    // Prefer a live line; if every line has expired, still let the user read
    // what is already in its inbox.
    const active = lines.filter((line) => line.status === "active");
    const candidates = active.length > 0 ? active : lines;
    const chosen = chooseLine(candidates, wanted);
    if (!chosen) {
      return `No Ghost line matches "${wanted}". Available lines: ${candidates
        .map((line) => line.phone_number)
        .join(", ")}.`;
    }

    const inbox = await tempNumberRequest<{ data?: unknown }>(
      `/numbers/${chosen.id}/sms`,
    );
    const data = inbox.data as TempNumberInbox | undefined;
    const messages = [...(data?.messages ?? [])].sort(
      (a, b) => timeOf(b.received_at) - timeOf(a.received_at),
    );
    const header = `Ghost line ${chosen.phone_number} (${chosen.status}, expires ${formatDay(
      chosen.expire_date,
    )})`;

    if (messages.length === 0) {
      return `${header}\nNo SMS has arrived yet.`;
    }

    const withCode = messages.find((message) => extractOtp(message.body));
    if (withCode) {
      const code = extractOtp(withCode.body);
      if (code) {
        return [
          header,
          `Latest OTP: ${code}`,
          `From: ${withCode.from}`,
          `Received: ${formatWhen(withCode.received_at)}`,
          `Message: ${clip(withCode.body)}`,
        ].join("\n");
      }
    }

    const latest: TempNumberMessage = messages[0];
    return [
      header,
      "No OTP was found in the inbox.",
      `Latest SMS from ${latest.from} at ${formatWhen(
        latest.received_at,
      )}: ${clip(latest.body)}`,
    ].join("\n");
  } catch (err) {
    return `Could not read the Ghost line: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}
