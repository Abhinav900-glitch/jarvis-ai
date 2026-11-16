"use node";

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  TEMPLATE_API_BASE,
  TEMPLATE_TOKEN_ENV,
  buildTemplatePayload,
  describeTemplateError,
} from "../lib/pptx/template-api";
import type { DeckSpec, SlideSpec } from "../lib/pptx/spec";

// ---------------------------------------------------------------------------
// Render a deck into a .pptx template.
//
// The bearer token is read from the environment and never leaves this action:
// it is not stored on a deck, not returned to the client, and not accepted as
// an argument. A token pasted into the UI would be a secret in the browser's
// memory and in every request log between here and the provider.
//
// The template bytes come from file storage, uploaded by the client directly.
// The generated file is stored back into storage too, so the download is a
// normal link rather than a base64 string passed through a mutation.
// ---------------------------------------------------------------------------

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Their synchronous endpoint holds the connection; this is its ceiling. */
const TIMEOUT_MS = 180_000;
const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024;

export const render = action({
  args: {
    deckId: v.id("decks"),
    templateStorageId: v.id("_storage"),
    /** Upload name; the payload's `presentation.template` must match it. */
    templateName: v.string(),
    /** Template slide to repeat for every deck slide (0-based). */
    slideIndex: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to render a template.");

    const token = process.env[TEMPLATE_TOKEN_ENV]?.trim();
    if (!token) {
      throw new Error(
        `${TEMPLATE_TOKEN_ENV} is not configured. Paste a bearer token from the PowerPoint Generator dashboard into Keys.`,
      );
    }

    const deck = await ctx.runQuery(internal.decks.load, { deckId: args.deckId, userId });
    if (!deck) throw new Error("Deck not found.");
    const slides = (deck.slides ?? []) as SlideSpec[];
    if (slides.length === 0) throw new Error("This deck has no slides yet.");

    const template = await ctx.storage.get(args.templateStorageId);
    if (!template) throw new Error("That template upload is gone. Upload it again.");
    if (template.size > MAX_TEMPLATE_BYTES) throw new Error("That template is over the 25 MB limit.");
    const bytes = await template.arrayBuffer();
    const head = new Uint8Array(bytes.slice(0, 2));
    // A .pptx is a ZIP; refusing anything else here turns "the provider said
    // 400" into a sentence the user can act on.
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      throw new Error("That file is not a .pptx. Upload the PowerPoint template itself.");
    }

    const spec: DeckSpec = {
      title: deck.title,
      theme: deck.theme,
      ratio: "16:9",
      transition: "fade",
      slides,
    };
    const templateName = args.templateName.trim().slice(0, 200) || "template.pptx";
    const payload = buildTemplatePayload(spec, {
      templateName,
      slideIndex: args.slideIndex ?? 0,
      fileName: deck.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "deck",
    });

    const form = new FormData();
    form.append("files", new Blob([bytes], { type: PPTX_MIME }), templateName);
    form.append("jsonData", JSON.stringify(payload));

    let response: Response;
    try {
      response = await fetch(`${TEMPLATE_API_BASE}/generator/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      throw new Error(
        /timeout|aborted/i.test(message)
          ? "PowerPoint Generator did not answer in time. Large templates need their async endpoint; try again with a simpler one."
          : "Could not reach PowerPoint Generator.",
      );
    }

    if (!response.ok) {
      throw new Error(describeTemplateError(response.status, await response.text().catch(() => "")));
    }

    // A 200 with JSON is a failure they reported politely; only a binary body
    // is the generated presentation.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      throw new Error(describeTemplateError(response.status, await response.text().catch(() => "")));
    }

    const output = await response.arrayBuffer();
    if (output.byteLength < 1024) {
      throw new Error("PowerPoint Generator returned an empty file.");
    }

    const storageId = await ctx.storage.store(new Blob([output], { type: PPTX_MIME }));
    return {
      storageId,
      url: await ctx.storage.getUrl(storageId),
      bytes: output.byteLength,
      slides: slides.length,
      templateName,
    };
  },
});
