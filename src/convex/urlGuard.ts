/**
 * SSRF guard — validate a user-supplied URL before fetching it server-side.
 * Blocks private/internal ranges, cloud-metadata endpoints, and non-http(s)
 * schemes. Returns the validated URL string or throws.
 *
 * It lives on its own because two callers now need it and neither may import
 * the other: `ai.ts` reads pages, `cloudinary.ts` downloads the source picture
 * for an image variation. Importing one from the other would drag the whole
 * model chain into a module that only wants a URL check.
 */
export function assertSafePublicUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }

  const host = parsed.hostname.toLowerCase();

  // Block localhost & literal IPs in private/reserved ranges
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" || // cloud metadata (AWS/GCP/Azure)
    host === "metadata.google.internal"
  ) {
    throw new Error("That URL is not allowed.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    const blocked =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (blocked) throw new Error("That URL is not allowed.");
  }
  // Block IPv6 loopback/link-local/metadata
  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    if (
      h === "::1" ||
      h.startsWith("fe80") ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("::ffff:127.")
    ) {
      throw new Error("That URL is not allowed.");
    }
  }

  return parsed.toString();
}
