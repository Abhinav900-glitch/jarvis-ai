/**
 * Saving a picture to disk without ever sending the user to another website.
 *
 * `<a download href="https://elsewhere.example/photo.jpg">` looks like a
 * download and behaves like a link: browsers ignore `download` on cross-origin
 * URLs, so clicking it navigates to the image (or the page that hosts it) and
 * the file is saved only if the user then remembers to right-click. Fetching
 * the bytes and handing the browser a blob URL is the only way to make the
 * button do the one thing it says.
 *
 * The fetch can still fail — plenty of sites serve images without CORS headers
 * — so the fallback opens the *image itself* in a new tab. Showing the file is
 * a worse outcome than saving it, and showing the hosting page instead is the
 * outcome the user explicitly did not want.
 */

/** Extension from the URL path, defaulting to jpg for extensionless CDNs. */
function extensionFor(url: string): string {
  try {
    const path = new URL(url, "https://placeholder.invalid").pathname;
    const match = /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.exec(path);
    if (!match) return "jpg";
    const ext = match[1].toLowerCase();
    return ext === "jpeg" ? "jpg" : ext;
  } catch {
    return "jpg";
  }
}

/** Two-digit padding without a date library. */
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A filename a person can find again: the prompt, slugged, plus a timestamp so
 * a second render of the same prompt does not overwrite the first.
 */
export function imageFileName(url: string, hint?: string, now: Date = new Date()): string {
  const slug = (hint ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${slug || "jarvis-image"}-${stamp}.${extensionFor(url)}`;
}

export type DownloadOutcome = "saved" | "opened";

/**
 * Save the image behind `url`. Browser-only, so it is called from click
 * handlers rather than during render.
 */
export async function downloadImage(
  url: string,
  filename: string,
): Promise<DownloadOutcome> {
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    if (!res.ok) throw new Error(`image fetch ${res.status}`);
    const blob = await res.blob();
    if (blob.size === 0) throw new Error("empty image");

    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Safari reads the blob asynchronously after the click; revoking straight
    // away produces an empty file there.
    window.setTimeout(() => URL.revokeObjectURL(href), 20_000);
    return "saved";
  } catch {
    // No CORS, no bytes. Open the picture itself — never the page it is on.
    window.open(url, "_blank", "noopener,noreferrer");
    return "opened";
  }
}
