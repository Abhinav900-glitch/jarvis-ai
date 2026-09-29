"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getTranslateLanguage } from "../lib/languages";

// ---------------------------------------------------------------------------
// Translation, via Sarvam.
//
// The Mayura model covers the eleven core languages and can auto-detect the
// source; Sarvam-Translate covers all 22 scheduled languages but is formal
// only. Callers pick the wide one by default because a mistranslation in the
// wrong script is a worse failure than a stiff translation.
// ---------------------------------------------------------------------------

export const translate = action({
  args: {
    text: v.string(),
    /** BCP-47 tag of the language to translate into. */
    target: v.string(),
    /** BCP-47 tag of the source, or "auto" to detect it. */
    source: v.optional(v.string()),
    /** "auto" picks the wide 22-language model; "core" forces Mayura. */
    coverage: v.optional(v.union(v.literal("auto"), v.literal("core"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    translated: string | null;
    target: string;
    targetName: string;
    source: string | null;
    engine: string;
    error: string | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use translation.");

    const language = getTranslateLanguage(args.target);
    if (!language) {
      return {
        translated: null,
        target: args.target,
        targetName: args.target,
        source: null,
        engine: "none",
        error: "That language isn't supported for translation.",
      };
    }

    const text = args.text.trim();
    if (!text) {
      return {
        translated: null,
        target: language.code,
        targetName: language.name,
        source: null,
        engine: "none",
        error: "Nothing to translate.",
      };
    }

    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      return {
        translated: null,
        target: language.code,
        targetName: language.name,
        source: null,
        engine: "none",
        error: "Translation needs a SARVAM_API_KEY.",
      };
    }

    // Both models cap the input; 2000 is the wider model's limit.
    const input = text.slice(0, 2000);
    const useWide = (args.coverage ?? "auto") === "auto";
    const body: Record<string, unknown> = {
      input,
      target_language_code: language.code,
      model: useWide ? "sarvam-translate:v1" : "mayura:v1",
    };
    // Auto-detection is a Mayura-only feature.
    body.source_language_code =
      args.source && args.source !== "auto"
        ? args.source
        : useWide
          ? "en-IN"
          : "auto";

    try {
      const res = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: {
          "api-subscription-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        // 403 covers both a bad key and a forbidden resource on Sarvam.
        const errText = await res.text().catch(() => "");
        console.error("Sarvam translate error", res.status, errText.slice(0, 300));
        return {
          translated: null,
          target: language.code,
          targetName: language.name,
          source: null,
          engine: "none",
          error:
            res.status === 403
              ? "The Sarvam key was rejected for translation."
              : res.status === 429
                ? "Translation rate limit reached — try again shortly."
                : `Translation failed (${res.status}).`,
        };
      }

      const data = (await res.json()) as {
        translated_text?: string;
        source_language_code?: string;
      };
      const translated = data.translated_text?.trim();
      if (!translated) {
        return {
          translated: null,
          target: language.code,
          targetName: language.name,
          source: data.source_language_code ?? null,
          engine: "none",
          error: "The translation came back empty.",
        };
      }

      return {
        translated,
        target: language.code,
        targetName: language.name,
        source: data.source_language_code ?? null,
        engine: body.model as string,
        error: null,
      };
    } catch (err) {
      console.error(
        "Sarvam translate failed:",
        err instanceof Error ? err.message : err,
      );
      return {
        translated: null,
        target: language.code,
        targetName: language.name,
        source: null,
        engine: "none",
        error: "Could not reach the translation service.",
      };
    }
  },
});
