// ---------------------------------------------------------------------------
// DeepL — the translation provider's language mapping.
//
// DeepL reads BCP-47 only in spirit: it wants upper-case codes and splits a
// handful of languages by region (EN-US vs EN-GB, PT-PT vs PT-BR, ZH-HANS vs
// ZH-HANT). It covers 30-odd languages — none of the Indic ones Sarvam handles —
// so the two providers are complementary rather than interchangeable, and the
// action tries DeepL first only when it actually speaks the target.
//
// Everything here is pure, so the awkward cases (a bare `en`, a `pt-BR` that
// must not become `PT-BR`'s neighbour, an unsupported `hi-IN`) are tested without
// a network call.
// ---------------------------------------------------------------------------

/** The languages DeepL's v2 API accepts, as bare upper-case codes. */
const DEEPL_LANGUAGES = new Set([
  "AR",
  "BG",
  "CS",
  "DA",
  "DE",
  "EL",
  "EN",
  "ES",
  "ET",
  "FI",
  "FR",
  "HU",
  "ID",
  "IT",
  "JA",
  "KO",
  "LT",
  "LV",
  "NB",
  "NL",
  "PL",
  "PT",
  "RO",
  "RU",
  "SK",
  "SL",
  "SV",
  "TR",
  "UK",
  "ZH",
]);

/**
 * The DeepL target code for a BCP-47 tag, or null when DeepL cannot translate
 * into it. A bare `en` becomes `EN-US`: DeepL still accepts plain `EN`, but it
 * is deprecated and picks the variant from the account instead of the request.
 */
export function deeplTargetLang(tag: string | null | undefined): string | null {
  const lower = (tag ?? "").trim().toLowerCase();
  const base = lower.split(/[-_]/)[0];
  if (!base) return null;

  if (base === "en") return lower.endsWith("-gb") ? "EN-GB" : "EN-US";
  if (base === "pt") return lower.includes("-br") ? "PT-BR" : "PT-PT";
  if (base === "zh") {
    // Traditional-script regions, plus the explicit `zh-Hant` tag.
    return /hant|-tw|-hk|-mo/.test(lower) ? "ZH-HANT" : "ZH-HANS";
  }

  const code = base.toUpperCase();
  return DEEPL_LANGUAGES.has(code) ? code : null;
}

/**
 * The DeepL *source* code, or null to let DeepL detect it.
 *
 * `auto` and empty both mean "detect". A source DeepL would reject (an Indic
 * tag, say) is also dropped rather than sent: detection is always available and
 * a 400 would cost the whole translation.
 */
export function deeplSourceLang(tag: string | null | undefined): string | null {
  const raw = (tag ?? "").trim();
  if (!raw || raw.toLowerCase() === "auto") return null;
  const code = deeplTargetLang(raw);
  if (!code) return null;
  // Source and target share their regional variants; -US is only valid as a
  // target, so send the plain code for the source side.
  return code.split("-")[0];
}

/**
 * The API host for a key.
 *
 * Free DeepL keys always end in `:fx` and live on a different host from Pro
 * keys, and a key sent to the wrong one is a plain 403. `override` exists so a
 * self-hosted proxy can be pointed at without code changes.
 */
export function deeplEndpoint(
  key: string,
  override?: string | null,
): string {
  const base = (override ?? "").trim().replace(/\/+$/, "");
  if (base) return base;
  return key.trim().endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
}
