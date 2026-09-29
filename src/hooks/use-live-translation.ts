/**
 * Live-mode translation.
 *
 * Two separate things, deliberately kept apart:
 *
 *  1. **Reply language** — Jarvis answers in the target language instead of the
 *     chat language. The instruction is appended to the turn's prompt, so the
 *     whole answer (not just the spoken part) is translated.
 *
 *  2. **Speech language** — the *already generated* English reply is run
 *     through Sarvam's translator and then spoken by a native voice for the
 *     target language. This is the useful one for a live call: you can keep
 *     reading the transcript in English while hearing it in your language.
 *
 * Both are opt-in and off by default.
 */
import { useCallback, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getTranslateLanguage } from "@/lib/languages";

export interface LiveTranslationState {
  /** Speak each reply in the target language (translate-then-speak). */
  speakTranslated: boolean;
  setSpeakTranslated: (v: boolean) => void;
  /** Ask Jarvis to answer in the target language in the first place. */
  answerTranslated: boolean;
  setAnswerTranslated: (v: boolean) => void;
  translating: boolean;
  error: string | null;
  /**
   * Returns the text to speak. When speech translation is on this is the
   * translated text; otherwise the original is returned untouched so callers
   * can pass the result straight to TTS.
   */
  forSpeech: (text: string, targetCode: string) => Promise<string>;
  /** Extra prompt line that steers the model's own answer language. */
  promptDirective: (targetCode: string) => string;
}

export function useLiveTranslation(): LiveTranslationState {
  const translateAction = useAction(api.translate.translate);
  const [speakTranslated, setSpeakTranslated] = useState(false);
  const [answerTranslated, setAnswerTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forSpeech = useCallback(
    async (text: string, targetCode: string) => {
      if (!speakTranslated) return text;
      const target = getTranslateLanguage(targetCode);
      if (!target) return text;
      if (!text.trim()) return text;
      setTranslating(true);
      setError(null);
      try {
        const result = await translateAction({
          text,
          target: target.code,
        });
        if (result.translated) return result.translated;
        // Sarvam didn't take it (unsupported pair, key issue) — speaking the
        // original in a native voice still beats silence.
        return text;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Live translation failed.",
        );
        return text;
      } finally {
        setTranslating(false);
      }
    },
    [speakTranslated, translateAction],
  );

  const promptDirective = useCallback(
    (targetCode: string) => {
      if (!answerTranslated) return "";
      const target = getTranslateLanguage(targetCode);
      if (!target) return "";
      return (
        `\n\nIMPORTANT: Reply entirely in ${target.name} (${target.native}). ` +
        `Use ${target.name} for all prose. Keep code, numbers, file paths, ` +
        `math and proper nouns exactly as-is. Put only the "SUGGEST:" line in ` +
        `${target.name}.`
      );
    },
    [answerTranslated],
  );

  return {
    speakTranslated,
    setSpeakTranslated,
    answerTranslated,
    setAnswerTranslated,
    translating,
    error,
    forSpeech,
    promptDirective,
  };
}
