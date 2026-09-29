// ---------------------------------------------------------------------------
// Languages & regions — country selection drives Live Mode behavior:
//   • Speech recognition language hint (Groq Whisper is multilingual)
//   • Jarvis's speaking language & persona (Hindi for India, etc.)
//   • TTS voice selection (browser voices matched by lang code)
// Author credit: Abhinav Kumar Dey (India)
// ---------------------------------------------------------------------------

export interface CountryConfig {
  code: string; // ISO country code
  name: string;
  flag: string;
  timezone: string; // default timezone for the region bar
  /** Primary spoken language for STT + persona */
  language: string;
  /** BCP-47 tag for Web Speech + browser TTS voice matching */
  langTag: string;
  /** Language name shown in UI */
  languageName: string;
  /** Persona instruction appended to the system prompt for this region */
  persona: string;
}

export const COUNTRIES: CountryConfig[] = [
  {
    code: "IN",
    name: "India",
    flag: "🇮🇳",
    timezone: "Asia/Kolkata",
    language: "hi",
    langTag: "hi-IN",
    languageName: "Hindi / English",
    persona:
      "The user is in India. Reply in Hindi (Devanagari script) by default, but freely mix English technical terms (Hinglish) the way Indians naturally speak. If the user writes in English, reply in English.",
  },
  {
    code: "US",
    name: "United States",
    flag: "🇺🇸",
    timezone: "America/New_York",
    language: "en",
    langTag: "en-US",
    languageName: "English (US)",
    persona: "The user is in the United States. Reply in American English, use US units (miles, °F) when relevant.",
  },
  {
    code: "GB",
    name: "United Kingdom",
    flag: "🇬🇧",
    timezone: "Europe/London",
    language: "en",
    langTag: "en-GB",
    languageName: "English (UK)",
    persona: "The user is in the United Kingdom. Reply in British English with British spelling and vocabulary.",
  },
  {
    code: "RU",
    name: "Russia",
    flag: "🇷🇺",
    timezone: "Europe/Moscow",
    language: "ru",
    langTag: "ru-RU",
    languageName: "Русский",
    persona:
      "The user is in Russia. Reply in Russian by default. If the user writes in English, reply in English.",
  },
  {
    code: "AU",
    name: "Australia",
    flag: "🇦🇺",
    timezone: "Australia/Sydney",
    language: "en",
    langTag: "en-AU",
    languageName: "English (AU)",
    persona: "The user is in Australia. Reply in Australian English, use metric units.",
  },
  {
    code: "AE",
    name: "UAE",
    flag: "🇦🇪",
    timezone: "Asia/Dubai",
    language: "ar",
    langTag: "ar-AE",
    languageName: "العربية",
    persona:
      "The user is in the UAE. Reply in Arabic by default. If the user writes in English, reply in English.",
  },
  {
    code: "DE",
    name: "Germany",
    flag: "🇩🇪",
    timezone: "Europe/Berlin",
    language: "de",
    langTag: "de-DE",
    languageName: "Deutsch",
    persona:
      "The user is in Germany. Reply in German by default. If the user writes in English, reply in English.",
  },
  {
    code: "FR",
    name: "France",
    flag: "🇫🇷",
    timezone: "Europe/Paris",
    language: "fr",
    langTag: "fr-FR",
    languageName: "Français",
    persona:
      "The user is in France. Reply in French by default. If the user writes in English, reply in English.",
  },
  {
    code: "JP",
    name: "Japan",
    flag: "🇯🇵",
    timezone: "Asia/Tokyo",
    language: "ja",
    langTag: "ja-JP",
    languageName: "日本語",
    persona:
      "The user is in Japan. Reply in Japanese by default. If the user writes in English, reply in English.",
  },
  {
    code: "CN",
    name: "China",
    flag: "🇨🇳",
    timezone: "Asia/Shanghai",
    language: "zh",
    langTag: "zh-CN",
    languageName: "中文",
    persona:
      "The user is in China. Reply in Simplified Chinese by default. If the user writes in English, reply in English.",
  },
  {
    code: "BR",
    name: "Brazil",
    flag: "🇧🇷",
    timezone: "America/Sao_Paulo",
    language: "pt",
    langTag: "pt-BR",
    languageName: "Português (BR)",
    persona:
      "The user is in Brazil. Reply in Brazilian Portuguese by default. If the user writes in English, reply in English.",
  },
  {
    code: "ES",
    name: "Spain",
    flag: "🇪🇸",
    timezone: "Europe/Madrid",
    language: "es",
    langTag: "es-ES",
    languageName: "Español",
    persona:
      "The user is in Spain. Reply in Spanish by default. If the user writes in English, reply in English.",
  },
  {
    code: "SG",
    name: "Singapore",
    flag: "🇸🇬",
    timezone: "Asia/Singapore",
    language: "en",
    langTag: "en-SG",
    languageName: "English (SG)",
    persona: "The user is in Singapore. Reply in English.",
  },
  {
    code: "NZ",
    name: "New Zealand",
    flag: "🇳🇿",
    timezone: "Pacific/Auckland",
    language: "en",
    langTag: "en-NZ",
    languageName: "English (NZ)",
    persona: "The user is in New Zealand. Reply in English.",
  },
];

export const DEFAULT_COUNTRY = "IN";

// ---------------------------------------------------------------------------
// Sarvam TTS language mapping
//
// Sarvam's Bulbul models cover eleven languages: ten Indic ones plus en-IN.
// It is the only provider in the voice chain that speaks those languages
// natively, so it is tried first for them and acts as the last-resort
// fallback everywhere else.
// ---------------------------------------------------------------------------

/** Language codes the Sarvam TTS API accepts. */
export const SARVAM_LANGUAGES = [
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN",
  "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
] as const;

/** Bare ISO codes that Sarvam serves with the Indian regional voice. */
const SARVAM_INDIC = new Set([
  "bn", "gu", "hi", "kn", "ml", "mr", "od", "pa", "ta", "te",
]);

/** The base language code of a BCP-47 tag ("hi-IN" → "hi"). */
function baseLanguage(langTag: string | null | undefined): string {
  return (langTag ?? "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * The Sarvam language_code for a BCP-47 tag, or null when Sarvam does not
 * serve that language at all (Arabic, Russian, Japanese, …) — in which case
 * the caller should skip the provider instead of burning a request.
 */
export function getSarvamLanguage(langTag: string | null | undefined): string | null {
  const tag = (langTag ?? "").trim();
  if ((SARVAM_LANGUAGES as readonly string[]).includes(tag)) return tag;

  const base = baseLanguage(tag);
  if (!base) return null;
  if (SARVAM_INDIC.has(base)) return `${base}-IN`;
  // English from anywhere maps onto Sarvam's Indian English voice.
  if (base === "en") return "en-IN";
  return null;
}

/** True when a tag needs Sarvam to sound right (any non-English Indic language). */
export function isIndicLangTag(langTag: string | null | undefined): boolean {
  return SARVAM_INDIC.has(baseLanguage(langTag));
}

// ---------------------------------------------------------------------------
// Sarvam translation languages
//
// The translate model covers all 22 scheduled Indian languages plus English —
// a much wider set than the ten the TTS voices cover, so this is its own
// list rather than a reuse of SARVAM_LANGUAGES.
// ---------------------------------------------------------------------------

export interface TranslateLanguage {
  code: string;
  name: string;
  native: string;
}

export const TRANSLATE_LANGUAGES: TranslateLanguage[] = [
  { code: "en-IN", name: "English", native: "English" },
  { code: "hi-IN", name: "Hindi", native: "हिन्दी" },
  { code: "bn-IN", name: "Bengali", native: "বাংলা" },
  { code: "ta-IN", name: "Tamil", native: "தமிழ்" },
  { code: "te-IN", name: "Telugu", native: "తెలుగు" },
  { code: "mr-IN", name: "Marathi", native: "मराठी" },
  { code: "gu-IN", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", name: "Malayalam", native: "മലയാളം" },
  { code: "pa-IN", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "od-IN", name: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "ur-IN", name: "Urdu", native: "اردو" },
  { code: "as-IN", name: "Assamese", native: "অসমীয়া" },
  { code: "ne-IN", name: "Nepali", native: "नेपाली" },
  { code: "sa-IN", name: "Sanskrit", native: "संस्कृतम्" },
  { code: "kok-IN", name: "Konkani", native: "कोंकणी" },
  { code: "mai-IN", name: "Maithili", native: "मैथिली" },
  { code: "mni-IN", name: "Manipuri", native: "মৈতৈলোন্" },
  { code: "sat-IN", name: "Santali", native: "সাঁতালি" },
  { code: "sd-IN", name: "Sindhi", native: "سنڌي" },
  { code: "doi-IN", name: "Dogri", native: "डोगरी" },
  { code: "ks-IN", name: "Kashmiri", native: "कٲशُر" },
  { code: "brx-IN", name: "Bodo", native: "बर' मैथिली" },
];

const TRANSLATE_CODES = new Set(TRANSLATE_LANGUAGES.map((l) => l.code));

/**
 * The Sarvam target language for a BCP-47 tag, or null when it is outside the
 * 22 scheduled languages. Callers skip the request rather than 422.
 */
export function getTranslateLanguage(
  langTag: string | null | undefined,
): TranslateLanguage | null {
  const tag = (langTag ?? "").trim();
  if (TRANSLATE_CODES.has(tag)) {
    return TRANSLATE_LANGUAGES.find((l) => l.code === tag) ?? null;
  }
  const base = baseLanguage(tag);
  if (base === "en") {
    return TRANSLATE_LANGUAGES[0];
  }
  const regional = `${base}-IN`;
  return TRANSLATE_CODES.has(regional)
    ? TRANSLATE_LANGUAGES.find((l) => l.code === regional) ?? null
    : null;
}

export function getCountry(code: string | null | undefined): CountryConfig {
  return (
    COUNTRIES.find((c) => c.code === code) ??
    COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY)!
  );
}

/** Author metadata — shown on the landing page and app footer. */
export const AUTHOR = {
  name: "Abhinav Kumar Dey",
  country: "India",
  flag: "🇮🇳",
  role: "Creator of Jarvis AI",
} as const;
