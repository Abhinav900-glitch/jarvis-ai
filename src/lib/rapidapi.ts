// ---------------------------------------------------------------------------
// RapidAPI as an MCP gateway.
//
// RapidAPI exposes every API in its catalogue as its own MCP server at
// https://mcp.rapidapi.com. One request carries two headers:
//
//   x-api-host: <api>.p.rapidapi.com   ← which API from the catalogue
//   x-api-key:  <application key>      ← the account's app key
//
// The app's MCP registry only stores one custom header per server, so a
// RapidAPI server is stored with x-api-host (the host is not a secret) and the
// key is injected here from the deployment environment on every call. That way
// "add another RapidAPI API" is a host, not a code change, and the key never
// lands in a database row.
// ---------------------------------------------------------------------------

/** The single marketplace gateway that fronts every RapidAPI API. */
export const RAPIDAPI_MCP_URL = "https://mcp.rapidapi.com";

const RAPIDAPI_HOST_RE = /^[a-z0-9][a-z0-9-]*\.p\.rapidapi\.com$/i;

/** True when a registry row points at the RapidAPI gateway. */
export function isRapidApiGateway(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "mcp.rapidapi.com";
  } catch {
    return false;
  }
}

/**
 * The x-api-host value for a pasted listing URL, host, or endpoint.
 *
 * Users copy whatever is on the page — "https://foo.p.rapidapi.com/weather",
 * "foo.p.rapidapi.com", or just the host from a code sample — so all of those
 * are reduced to the host the gateway expects. Anything else returns null
 * rather than sending a nonsense host to a paid call.
 */
export function rapidApiHostOf(value: string): string | null {
  const host = value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  return RAPIDAPI_HOST_RE.test(host) ? host : null;
}

/** The account's application key, under either name the Keys tab may hold. */
export function rapidApiKey(): string | null {
  const key = (
    process.env.RAPIDAPI_KEY ??
    process.env.RAPIDAPI_API_KEY ??
    ""
  ).trim();
  return key || null;
}

/** The host a RapidAPI server row is pointed at, if any. */
export function rapidApiGatewayHost(
  headers: Record<string, string>,
): string | null {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "x-api-host") return rapidApiHostOf(value);
  }
  return null;
}

/**
 * Add the key to a RapidAPI gateway request.
 *
 * Every other server passes through untouched. A gateway request without a
 * valid host is left as it was too — the server's own error is more useful
 * than a header guessed here.
 */
export function withRapidApiAuth(
  url: string,
  headers: Record<string, string>,
): Record<string, string> {
  if (!isRapidApiGateway(url)) return headers;
  const host = rapidApiGatewayHost(headers);
  if (!host) return headers;

  const key = rapidApiKey();
  if (!key) return headers;

  // Normalise the host even when the row's header held a full URL.
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "x-api-host") headers[name] = host;
  }
  headers["x-api-key"] = key;
  return headers;
}

/**
 * A tool-name prefix unique to this API.
 *
 * Two RapidAPI servers share the gateway URL, so unlike every other connector
 * they cannot share a prefix: tool names are what the model calls, and a
 * collision silently hides the second API's tools.
 */
export function rapidApiPrefix(host: string): string {
  const label = host.split(".")[0].replace(/[^a-z0-9_]/g, "_");
  return `rapidapi_${label}`;
}
