// ---------------------------------------------------------------------------
// Export sizes.
//
// A generated picture is whatever shape the generator felt like. Everything it
// is actually used for has a fixed shape: a feed post, a story, a slide, a
// listing thumbnail. Re-rendering to get the right crop costs another credit
// and gives a different picture, so the crop happens here instead — the same
// pixels, cut to the shape it is needed in.
//
// The crop is "cover": the largest part of the source with the target's aspect,
// centred, then scaled down. Letterboxing would keep every pixel and look like
// a mistake in a feed, which is the one place these crops get used.
//
// `coverRect` is pure so the geometry can be tested without a canvas; the
// canvas part runs in the browser and fails loudly when a host refuses
// cross-origin reads.
// ---------------------------------------------------------------------------

export interface ExportPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  hint: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "post", label: "Post", width: 1080, height: 1080, hint: "square feed" },
  { id: "story", label: "Story", width: 1080, height: 1920, hint: "9:16 vertical" },
  { id: "wide", label: "Wide", width: 1920, height: 1080, hint: "16:9, slides" },
  { id: "thumb", label: "Thumb", width: 640, height: 360, hint: "listings" },
];

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The centred cover crop: the largest source rectangle with the target's
 * aspect ratio.
 *
 * Returns null for a source or target with no area — a broken image has no
 * crop, and a zero width would make `drawImage` throw instead of explaining.
 */
export function coverRect(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): CropRect | null {
  if (!(srcW > 0) || !(srcH > 0) || !(targetW > 0) || !(targetH > 0)) return null;

  const targetAspect = targetW / targetH;
  const srcAspect = srcW / srcH;

  let sw: number;
  let sh: number;
  if (srcAspect > targetAspect) {
    // Wider than the target: keep the full height, trim the sides.
    sh = srcH;
    sw = srcH * targetAspect;
  } else {
    sw = srcW;
    sh = srcW / targetAspect;
  }

  // A crop is a pixel rectangle; rounding here keeps the drawn image from
  // picking up a half-pixel edge on either side.
  sw = Math.max(1, Math.round(sw));
  sh = Math.max(1, Math.round(sh));
  return {
    sx: Math.round((srcW - sw) / 2),
    sy: Math.round((srcH - sh) / 2),
    sw,
    sh,
  };
}

/** A filename that says which size it is, so a downloaded set sorts together. */
export function exportFileName(
  hint: string | undefined,
  preset: ExportPreset,
  now: Date = new Date(),
): string {
  const slug = (hint ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const stamp =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  return `${slug || "jarvis-image"}-${preset.id}-${preset.width}x${preset.height}-${stamp}.png`;
}

/** Load an image for drawing; rejects with a reason the UI can show. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Anonymous so the canvas is not tainted by a cookie-carrying response —
    // a tainted canvas can be drawn on but never encoded, which is the export.
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new Error(
          "Couldn't read that image for cropping — its host blocks cross-origin reads. Downloading it directly still works.",
        ),
      );
    image.src = url;
  });
}

/**
 * Crop and scale `url` into `preset`, returning PNG bytes.
 *
 * Browser-only: called from a click handler, never during render.
 */
export async function renderPreset(url: string, preset: ExportPreset): Promise<Uint8Array> {
  const image = await loadImage(url);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const rect = coverRect(width, height, preset.width, preset.height);
  if (!rect) throw new Error("That image reported no size, so there was nothing to crop.");

  const canvas = document.createElement("canvas");
  canvas.width = preset.width;
  canvas.height = preset.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser did not give the studio a canvas to draw on.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, preset.width, preset.height);

  let blob: Blob | null = null;
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  } catch {
    // A tainted canvas throws here rather than returning null.
    throw new Error(
      "That image can't be re-encoded in the browser — its host doesn't allow canvas export. Downloading it directly still works.",
    );
  }
  if (!blob || blob.size === 0) {
    throw new Error("The cropped image came back empty — nothing was encoded.");
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/** Copy bytes into a plain buffer so `Blob` accepts them under strict DOM types. */
export function toBlob(bytes: Uint8Array, type = "image/png"): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}
