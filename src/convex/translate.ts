"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getTranslateLanguage } from "../lib/languages";
import { deeplEndpoint, deeplSourceLang, deeplTargetLang } from "../lib/deepl";

// ---------------------------------------------------------------------------
// Translation, via DeepL and Sarvam.
//
// The two providers cover different halves of the world and neither is a
// fallback for the other's quality:
//
//   • DeepL — 30-odd languages, the best prose among European and CJK pairs.
//   • Sarvam — the 22 scheduled Indian languages, which DeepL does not carry
//     at all. The Mayura model covers the eleven core ones and can auto-detect
//     the source; Sarvam-Translate covers all 22 but is formal only.
//
// So the chain is capability-first, not preference-first: DeepL is tried when
// it speaks the target, Sarvam when it does not (or when DeepL failed), and the
// answer names the engine that produced it so a stiff translation from Sarvam
// is never mistaken for a DeepL one.
//
// `target` is a BCP-47 tag. Anything outside both languages' coverage is
// rejected up front rather than sent to a provider that will 400.
// ---------------------------------------------------------------------------

/** Both providers cap input; 2000 is Sarvam's narrower model's limit. */
const MAX_INPUT = 2000;

interface TranslationResult {
  translated: string | null;
  target: string;
  targetName: string;
  source: string | null;
  engine: string;
  error: string | null;
}

/** A human-readable name for a tag neither provider knows. */
function displayName(tag: string): string {
  const base = tag.split("-")[0].toLowerCase();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(base) ?? tag;
  } catch {
    return tag.toUpperCase();
  }
}

async function translateWithDeepL(
  key: string,
  text: string,
  target: string,
  targetName: string,
  source?: string,
): Promise<TranslationResult | null> {
  const targetLang = deeplTargetLang(target);
  if (!targetLang) return null;

  try {
    const res = await fetch(`${deeplEndpoint(key, process.env.DEEPL_API_URL)}/v2/translate`, {
      method: "POST",
      headers: {
        // DeepL's own scheme, not a bearer token.
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: [text],
        target_lang: targetLang,
        ...(deeplSourceLang(source) ? { source_lang: deeplSourceLang(source) } : {}),
        // Preserve paragraph breaks; a chat reply arrives multi-line often.
        preserve_formatting: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("DeepL translate error", res.status, errText.slice(0, 300));
      return {
        translated: null,
        target,
        targetName,
        source: null,
        engine: "deepl",
        error:
          res.status === 403 || res.status === 401
            ? "The DeepL key was rejected — check DEEPL_API_KEY (free keys end in :fx)."
            : res.status === 456
              ? "The DeepL character quota is used up for this billing period."
              : res.status === 429
                ? "DeepL rate limit reached — try again shortly."
                : `DeepL translation failed (${res.status}).`,
      };
    }

    const data = (await res.json()) as {
      translations?: { text?: string; detected_source_language?: string }[];
    };
    const first = data.translations?.[0];
    const translated = first?.text?.trim();
    if (!translated) {
      return {
        translated: null,
        target,
        targetName,
        source: null,
        engine: "deepl",
        error: "DeepL returned an empty translation.",
      };
    }

    return {
      translated,
      target,
      targetName,
      source: first?.detected_source_language?.toLowerCase() ?? null,
      engine: "deepl",
      error: null,
    };
  } catch (err) {
    console.error(
      "DeepL translate failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      translated: null,
      target,
      targetName,
      source: null,
      engine: "deepl",
      error: "Could not reach DeepL.",
    };
  }
}

async function translateWithSarvam(
  key: string,
  text: string,
  language: { code: string; name: string },
  args: { source?: string; coverage?: "auto" | "core" },
): Promise<TranslationResult> {
  const useWide = (args.coverage ?? "auto") === "auto";
  const body: Record<string, unknown> = {
    input: text,
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

  const fail = (error: string): TranslationResult => ({
    translated: null,
    target: language.code,
    targetName: language.name,
    source: null,
    engine: "none",
    error,
  });

  try {
    const res = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      // 403 covers both a bad key and a forbidden resource on Sarvam.
      const errText = await res.text().catch(() => "");
      console.error("Sarvam translate error", res.status, errText.slice(0, 300));
      return fail(
        res.status === 403
          ? "The Sarvam key was rejected for translation."
          : res.status === 429
            ? "Translation rate limit reached — try again shortly."
            : `Translation failed (${res.status}).`,
      );
    }

    const data = (await res.json()) as {
      translated_text?: string;
      source_language_code?: string;
    };
    const translated = data.translated_text?.trim();
    if (!translated) return fail("The translation came back empty.");

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
    return fail("Could not reach the translation service.");
  }
}

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
  handler: async (ctx, args): Promise<TranslationResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use translation.");

    const text = args.text.trim();
    if (!text) {
      return {
        translated: null,
        target: args.target,
        targetName: displayName(args.target),
        source: null,
        engine: "none",
        error: "Nothing to translate.",
      };
    }

    const deeplKey = process.env.DEEPL_API_KEY?.trim();
    const sarvamKey = process.env.SARVAM_API_KEY?.trim();
    // Sarvam's list decides the name and whether it can take the target at all;
    // DeepL's mapping decides the same for its side.
    const language = getTranslateLanguage(args.target);
    const deeplCan = deeplTargetLang(args.target) !== null;
    const targetName = language?.name ?? displayName(args.target);
    const input = text.slice(0, MAX_INPUT);

    if (!language && !(deeplKey && deeplCan)) {
      return {
        translated: null,
        target: args.target,
        targetName,
        source: null,
        engine: "none",
        error: "That language isn't supported for translation.",
      };
    }

    // DeepL first where it is capable: better prose, and it is the only of the
    // two that can handle most of what a user in Europe or East Asia asks for.
    let deeplError: string | null = null;
    if (deeplKey && deeplCan) {
      const attempt = await translateWithDeepL(
        deeplKey,
        input,
        args.target,
        targetName,
        args.source,
      );
      if (attempt?.translated) return attempt;
      deeplError = attempt?.error ?? null;
      // A rejected key or an exhausted quota will not improve for Sarvam, but
      // neither should block it: Sarvam covers languages DeepL has never had.
    }

    if (!sarvamKey || !language) {
      return {
        translated: null,
        target: args.target,
        targetName,
        source: null,
        engine: "none",
        error:
          deeplError ??
          (language
            ? "Translation needs a SARVAM_API_KEY."
            : `DeepL can't translate into ${targetName}.`),
      };
    }

    return await translateWithSarvam(sarvamKey, input, language, args);
  },
});
