// ---------------------------------------------------------------------------
// Voice catalogue & preference.
//
// Sarvam's Bulbul v3 exposes 36 speakers and ElevenLabs has a set of
// multilingual voices, but neither documents what each one *sounds* like — so
// this catalogue deliberately describes none of them. The picker is built
// around previewing instead: tap a name, hear it, keep the one that suits you.
// Guessing at "warm" or "deep" from a name would be worse than useless.
//
// The choice is persisted locally and threaded through every speech path:
// live mode, the per-message play button, and the pronunciation pass.
// ---------------------------------------------------------------------------

export type VoiceProvider = "auto" | "sarvam" | "elevenlabs";

/** Every speaker Bulbul v3 accepts (lowercase, case-sensitive server-side). */
export const SARVAM_SPEAKERS = [
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan",
  "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
  "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait", "anand",
  "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
  "mohit", "kavitha", "rehan", "soham", "rupali",
] as const;

/**
 * ElevenLabs voices that actually return audio on a free plan. Popular voices
 * such as Rachel return 402 paid_plan_required, so they are intentionally
 * absent.
 */
export const ELEVENLABS_VOICES = [
  { id: "brian", note: "deep, resonant" },
  { id: "sarah", note: "mature, reassuring" },
  { id: "daniel", note: "steady broadcaster" },
  { id: "adam", note: "firm" },
  { id: "roger", note: "laid-back" },
  { id: "chris", note: "charming, down-to-earth" },
  { id: "alice", note: "clear, engaging" },
  { id: "george", note: "warm, storytelling" },
  { id: "matilda", note: "knowledgeable, professional" },
  { id: "river", note: "relaxed, neutral" },
] as const;

export interface VoicePreference {
  provider: VoiceProvider;
  /** Sarvam speaker id, e.g. "shubh". */
  speaker?: string;
  /** ElevenLabs voice id/name, e.g. "brian". */
  voice?: string;
  /** 0.5–2.0. 1 is natural; 1.15 noticeably livelier for short answers. */
  pace: number;
}

export const DEFAULT_VOICE_PREFERENCE: VoicePreference = {
  provider: "auto",
  pace: 1,
};

const STORAGE_KEY = "jarvis-voice";

/** Read the saved preference, tolerating absent or corrupt storage. */
export function loadVoicePreference(): VoicePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCE;
    const parsed = JSON.parse(raw) as Partial<VoicePreference>;
    const provider: VoiceProvider =
      parsed.provider === "sarvam" || parsed.provider === "elevenlabs"
        ? parsed.provider
        : "auto";
    const pace =
      typeof parsed.pace === "number" && parsed.pace >= 0.5 && parsed.pace <= 2
        ? parsed.pace
        : 1;
    return {
      provider,
      speaker: typeof parsed.speaker === "string" ? parsed.speaker : undefined,
      voice: typeof parsed.voice === "string" ? parsed.voice : undefined,
      pace,
    };
  } catch {
    return DEFAULT_VOICE_PREFERENCE;
  }
}

export function saveVoicePreference(preference: VoicePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* storage unavailable — the preference just won't persist */
  }
}

/** A short line describing what is currently selected, for the panel header. */
export function describeVoice(pref: VoicePreference): string {
  if (pref.provider === "sarvam" && pref.speaker) return `Sarvam · ${pref.speaker}`;
  if (pref.provider === "elevenlabs" && pref.voice) return `ElevenLabs · ${pref.voice}`;
  return "Automatic";
}

/** Sample line used by the preview buttons. */
export const VOICE_PREVIEW_TEXT =
  "Jarvis here. All systems are online and ready when you are.";
