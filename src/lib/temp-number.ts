// ---------------------------------------------------------------------------
// Temp Number (temp-number.com) — buy a private number and read its SMS.
//
// The API key belongs to one wallet and gives read/write access to that
// account only. It is used exclusively on the server; the browser never sees
// it. Money-moving calls (buy, renew, cancel) require an Idempotency-Key, and
// every request must carry the bearer token.
// ---------------------------------------------------------------------------

export const TEMP_NUMBER_API_BASE = "https://api.temp-number.com/v1";

export function tempNumberApiKey(): string | null {
  const value = (process.env.TEMP_NUMBER_API_KEY ?? "").trim();
  return value || null;
}

export const TEMP_NUMBER_DURATIONS = [
  "halfDay",
  "oneDay",
  "oneWeek",
  "oneMonth",
  "threeMonths",
  "sixMonths",
  "oneYear",
] as const;

export type TempNumberDuration = (typeof TEMP_NUMBER_DURATIONS)[number];

export function normalizeTempDuration(value: string): TempNumberDuration {
  const found = TEMP_NUMBER_DURATIONS.find((duration) => duration === value);
  if (!found) throw new Error("Choose a valid number duration.");
  return found;
}

export function normalizeTempNumberType(
  value: string | undefined,
): "voip" | "non_voip" | null {
  if (!value) return null;
  if (value === "voip" || value === "non_voip") return value;
  throw new Error("Choose a valid number type.");
}

export interface TempNumberAccount {
  balance: number;
  currency: string;
}

export interface TempNumberPackage {
  number_type: string;
  duration: string;
  duration_label: string;
  price: number;
  original_price: number | null;
}

export interface TempNumberCountry {
  country_code: string;
  country_name: string;
  packages: TempNumberPackage[];
}

export interface TempNumberInventory {
  country_code: string;
  duration: string;
  number_type: string | null;
  stock: number | null;
  available: boolean;
  status: string;
  types: Array<{
    number_type: string;
    stock: number;
    available: boolean;
    status: string;
  }>;
}

export interface TempNumberNumber {
  id: number;
  phone_number: string;
  country_code: string | null;
  country_name: string;
  number_type: string;
  status: string;
  purchase_date: string;
  expire_date: string;
}

export interface TempNumberMessage {
  id: number;
  from: string;
  body: string;
  received_at: string;
}

export interface TempNumberInbox {
  number: TempNumberNumber;
  messages: TempNumberMessage[];
}

/**
 * One request against Temp Number.
 *
 * Every response is JSON, including errors. The API's `code` is surfaced with
 * the human message so the dashboard can show "insufficient_funds: …" instead
 * of a bare status. Read calls are given 20 seconds; buying and releasing can
 * take longer, so those pass a wider timeout.
 */
export async function tempNumberRequest<T>(
  path: string,
  init?: {
    method?: "GET" | "POST";
    body?: unknown;
    idempotencyKey?: string;
    timeoutMs?: number;
  },
): Promise<T> {
  const key = tempNumberApiKey();
  if (!key) throw new Error("TEMP_NUMBER_API_KEY is not configured.");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
  if (init?.body !== undefined) headers["Content-Type"] = "application/json";
  if (init?.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  const response = await fetch(`${TEMP_NUMBER_API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined
      ? { body: JSON.stringify(init.body) }
      : {}),
    signal: AbortSignal.timeout(init?.timeoutMs ?? 20_000),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON error still needs the status in its message.
  }

  if (!response.ok) {
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : `Temp Number answered ${response.status}.`;
    const code =
      typeof record.code === "string" ? `${record.code}: ` : "";
    throw new Error(`${code}${message}`.slice(0, 400));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Temp Number returned an unexpected response.");
  }
  return parsed as T;
}
