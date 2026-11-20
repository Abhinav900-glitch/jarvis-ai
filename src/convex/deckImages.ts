"use node";

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertSafePublicUrl } from "./urlGuard";

// ---------------------------------------------------------------------------
// A real picture for a slide that asked for one.
//
// The deck writer plans "image" slides from the outline alone — it cannot see
// the web and must not invent a picture — so every one of them starts as a
// placeholder. This is the step that fills that placeholder: search Google
// Images once, take the most usable result, and store it on the slide as a
// data URL so the downloaded .pptx carries the bytes rather than a link that
// can rot.
//
// Three rules are what keep it from being a liability:
//  * the file has to be a raster type the .pptx writer can embed (png, jpeg,
//    gif) — a webp or an svg would produce a deck that PowerPoint reports as
//    corrupted, long after anyone would connect it to this step;
//  * the SSRF guard runs on the image URL *and* on the final URL after
//    redirects, because an image host is as good a way as any to reach
//    169.254.169.254;
//  * the bytes are capped. A Convex document is 1 MB, and a 4 MB photo would
//    fail the write with an error that says nothing about image sizes.
//
// It writes through an internal mutation so a client can never post a data URL
// onto its own deck: the same rule as slide rewrites.
// ---------------------------------------------------------------------------

/** Base64 characters, not bytes — 1 MB documents, with room for the slide. */
const MAX_BASE64 = 700_000;

const CONTENT_TYPES = /^image\/(png|jpe?g|gif)$/i;

interface FoundImage {
  url: string;
  pageUrl: string;
  source: string;
  title?: string;
  width?: number;
  height?: number;
}

function serpKeys(): string[] {
  return [
    process.env.SERPAPI_API_KEY,
    process.env.SERPAPI_API_KEY_2,
    process.env.SERPAPI_API_KEY2,
  ]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key));
}

async function searchImages(key: string, query: string): Promise<FoundImage[]> {
  const url =
    "https://serpapi.com/search.json?engine=google_images" +
    `&q=${encodeURIComponent(query)}&num=10&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`serpapi images ${res.status}`);
  const data = (await res.json()) as {
    error?: string;
    images_results?: {
      original?: string;
      link?: string;
      source?: string;
      title?: string;
      original_width?: number;
      original_height?: number;
    }[];
  };
  if (data.error) throw new Error(`serpapi: ${data.error}`);
  return (data.images_results ?? [])
    .filter((r) => typeof r.original === "string" && /^https?:\/\//i.test(r.original))
    .map((r) => ({
      url: r.original as string,
      pageUrl: r.link ?? "",
      source: r.source ?? "",
      title: r.title,
      width: typeof r.original_width === "number" ? r.original_width : undefined,
      height: typeof r.original_height === "number" ? r.original_height : undefined,
    }));
}

/**
 * Rank for a slide's picture box.
 *
 * A deck image sits beside a column of text, so landscape beats portrait and a
 * picture under ~800px wide prints as mush. Portrait and square shots are kept,
 * just later: a portrait photo of a person is still the right picture for a
 * quote slide, while a 200px-wide logo never is.
 */
function rankForSlide(images: FoundImage[]): FoundImage[] {
  const score = (image: FoundImage): number => {
    const width = image.width ?? 0;
    const height = image.height ?? 0;
    const ratio = width && height ? width / height : 1.5;
    const shape = ratio >= 1.2 && ratio <= 2.4 ? 2 : ratio > 2.4 ? 0.5 : 1;
    const size = width >= 1200 ? 2 : width >= 800 ? 1.5 : width >= 400 ? 0.75 : 0;
    return shape + size;
  };
  return [...images].sort((a, b) => score(b) - score(a));
}

/** Fetch one candidate as a data URL, or say why it could not be used. */
async function asDataUrl(
  image: FoundImage,
): Promise<{ dataUrl: string; caption: string } | { reason: string }> {
  let target: string;
  try {
    target = assertSafePublicUrl(image.url);
  } catch (err) {
    return { reason: err instanceof Error ? err.message : "Unsafe image URL." };
  }

  const res = await fetch(target, {
    headers: { Accept: "image/png,image/jpeg,image/gif" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { reason: `Image host answered ${res.status}.` };

  // A redirect is a second URL, so it gets the same guard as the first.
  try {
    assertSafePublicUrl(res.url);
  } catch {
    return { reason: "The image host redirected somewhere private." };
  }

  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!CONTENT_TYPES.test(type)) {
    return { reason: `That result is ${type || "not an image"}, which a .pptx cannot embed.` };
  }
  const announced = Number(res.headers.get("content-length") ?? "0");
  if (announced > (MAX_BASE64 * 3) / 4) {
    return { reason: "That picture is too large for a slide." };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > (MAX_BASE64 * 3) / 4) {
    return { reason: "That picture is too large for a slide." };
  }

  const mime = /png/i.test(type) ? "png" : /gif/i.test(type) ? "gif" : "jpeg";
  const credit = image.source?.trim() || image.pageUrl?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "";
  const caption = [image.title?.trim(), credit].filter(Boolean).join(" — ").slice(0, 160);
  return {
    dataUrl: `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    caption,
  };
}

/**
 * Find and attach a web picture to one slide.
 *
 * `query` lets the presenter override the search ("a container port at night"),
 * which is the difference between the picture the slide is about and the
 * picture its title happens to name.
 */
export const find = action({
  args: {
    deckId: v.id("decks"),
    index: v.number(),
    query: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; caption?: string; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to add an image to a deck.");

    const deck = await ctx.runQuery(internal.decks.load, { deckId: args.deckId, userId });
    if (!deck) throw new Error("Deck not found.");

    const slides = (deck.slides ?? []) as { title?: string; kind?: string }[];
    const slide = slides[args.index];
    if (!slide) throw new Error("That slide is no longer in the deck.");

    const typed = (args.query ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const query = typed || [slide.title, deck.topic].filter(Boolean).join(" — ").slice(0, 200);

    const keys = serpKeys();
    if (keys.length === 0) {
      return { ok: false, reason: "SERPAPI_API_KEY is not configured, so there is no image search." };
    }

    let candidates: FoundImage[] = [];
    let failure = "Image search failed.";
    for (const key of keys) {
      try {
        candidates = await searchImages(key, query);
        failure = "No matching images on the web.";
        break;
      } catch (err) {
        failure = err instanceof Error ? err.message : "Image search failed.";
      }
    }
    if (candidates.length === 0) return { ok: false, reason: failure };

    // Four tries: a dead host or a webp is common enough that giving up on the
    // first result would make the button feel broken.
    for (const candidate of rankForSlide(candidates).slice(0, 4)) {
      try {
        const result = await asDataUrl(candidate);
        if ("reason" in result) {
          failure = result.reason;
          continue;
        }
        await ctx.runMutation(internal.decks.setSlideImage, {
          deckId: args.deckId,
          index: args.index,
          image: result,
        });
        return { ok: true, caption: result.caption };
      } catch (err) {
        failure = err instanceof Error ? err.message : "Could not download that picture.";
      }
    }
    return { ok: false, reason: failure };
  },
});
