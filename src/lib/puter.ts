// Puter.js integration — free, keyless AI image generation in the browser.
// https://docs.puter.com/AI/txt2img — the script is loaded lazily from
// js.puter.com/v2/ and generation runs under Puter's "User Pays" model
// (the end user's free Puter allowance covers it; first use may show a
// Puter sign-in popup). Generated images are returned as blobs so the app
// can store them on Cloudinary like every other provider's output.

interface PuterAi {
  txt2img: (
    prompt: string,
    testMode?: boolean,
  ) => Promise<Blob | HTMLImageElement | string>;
}

interface PuterGlobal {
  ai?: PuterAi;
}

const PUTER_SCRIPT_SRC = "https://js.puter.com/v2/";
/** The SDK attaches `puter.ai` after its own load event, so poll for it
 *  rather than trusting onload to mean "ready". */
const READY_POLL_MS = 100;
const READY_TIMEOUT_MS = 15_000;
const SCRIPT_TIMEOUT_MS = 20_000;
export const PUTER_LOAD_TIMEOUT_MS = 30_000;
/** Generous: image models plus a first-run sign-in popup can be slow. */
export const PUTER_GENERATE_TIMEOUT_MS = 120_000;

/**
 * Puter rejects with a plain `{ code, msg }` object, not an Error, so the
 * default `String(err)` renders "[object Object]" and hides the reason.
 * Turn every rejection shape into text a user can act on.
 */
export function describePuterError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e.trim() || "Unknown Puter error.";
  if (e && typeof e === "object") {
    const rec = e as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code : "";
    const msg = typeof rec.msg === "string" ? rec.msg : "";
    switch (code) {
      case "popup_blocked":
        return "Puter's sign-in popup was blocked by the browser. Generate from the Generate button in a normal tab, and allow popups for this site.";
      case "auth_window_closed":
        return "The Puter sign-in window was closed before signing in. Try again and finish the Puter sign-in popup.";
      case "unsupported_origin":
        return "Puter cannot sign in from this page origin (blocked or sandboxed frame). Open the app in its own tab.";
      case "rate_limit_exceeded":
        return "Puter rate limit reached. Wait a moment before generating again.";
      case "insufficient_funds":
      case "out_of_credits":
        return "This Puter account has no image credits left.";
      default:
        break;
    }
    if (code && msg) return `${code}: ${msg}`;
    if (msg) return msg;
    if (code) return code;
  }
  const fallback = String(e);
  return fallback && fallback !== "[object Object]"
    ? fallback
    : "Unknown Puter error.";
}

/** Reject/wait guard so a stuck script or hung API call can't deadlock the
 *  fallback chain — callers need a failure to move on. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s.`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(new Error(describePuterError(e)));
      },
    );
  });
}

function windowPuter(): PuterGlobal | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { puter?: PuterGlobal };
  return w.puter ?? null;
}

function injectScript(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PUTER_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          "Could not load the Puter.js script — blocked by the network or an extension.",
        ),
      );
    document.head.appendChild(script);
  });
}

/** Poll until `puter.ai.txt2img` is actually callable. */
async function waitForAi(): Promise<PuterGlobal | null> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const puter = windowPuter();
    if (puter?.ai?.txt2img) return puter;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
}

let puterPromise: Promise<PuterGlobal> | null = null;

async function loadPuterInner(): Promise<PuterGlobal> {
  if (!document.querySelector(`script[src="${PUTER_SCRIPT_SRC}"]`)) {
    await withTimeout(
      injectScript(),
      SCRIPT_TIMEOUT_MS,
      "Puter.js script download",
    );
  }
  const puter = await waitForAi();
  if (!puter) {
    throw new Error(
      "Puter.js loaded but never became ready — an extension may be blocking it.",
    );
  }
  return puter;
}

function loadPuter(): Promise<PuterGlobal> {
  if (puterPromise) return puterPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter.js needs a browser to run."));
  }
  puterPromise = loadPuterInner();
  // Never cache a failure: a flaky CDN or an ad-blocker that recovers must
  // not disable Puter for the rest of the page session.
  puterPromise.catch(() => {
    puterPromise = null;
  });
  return puterPromise;
}

async function toBlob(el: Blob | HTMLImageElement | string): Promise<Blob> {
  if (el instanceof Blob) return el;
  const src =
    typeof el === "string"
      ? el
      : el instanceof HTMLImageElement
        ? el.src
        : null;
  if (!src) throw new Error("Puter returned an unexpected image format.");
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Could not fetch the generated image (${res.status}).`);
  }
  return res.blob();
}

/**
 * Generate an image with Puter.js and store it via the provided uploader
 * (the app's signed Cloudinary upload). Throws on any failure so callers
 * can fall back to the server-side provider chain.
 */
export async function generateImageWithPuter(
  prompt: string,
  upload: (file: File) => Promise<{ url: string; publicId: string } | null>,
): Promise<{ url: string; publicId: string; provider: string }> {
  const puter = await withTimeout(
    loadPuter(),
    PUTER_LOAD_TIMEOUT_MS,
    "Puter.js load",
  );
  if (!puter.ai?.txt2img) {
    throw new Error("Puter.js is unavailable in this browser.");
  }
  // txt2img can hang indefinitely if the sign-in popup is dismissed without
  // completing auth — bound it so callers can fall back cleanly.
  const raw = await withTimeout(
    Promise.resolve(puter.ai.txt2img(prompt)),
    PUTER_GENERATE_TIMEOUT_MS,
    "Puter image generation",
  );
  const blob = await toBlob(raw);
  const file = new File([blob], `jarvis-puter-${Date.now()}.png`, {
    type: blob.type || "image/png",
  });
  const stored = await upload(file);
  if (!stored) throw new Error("Could not store the generated image.");
  return { ...stored, provider: "puter" };
}
