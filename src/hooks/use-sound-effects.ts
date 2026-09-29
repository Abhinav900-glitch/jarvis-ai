import { useCallback, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { audioMimeType, unlockAudioElement } from "@/lib/audio";
import { type SoundCue, findSoundCues } from "@/lib/sound-effects";

export interface SoundEffects {
  /**
   * Play every cue a message asks for, in order. Resolves true when at least
   * one clip played. A chain like "dog then cat then lion" plays all three.
   */
  play: (text: string) => Promise<boolean>;
  /** Play one cue. */
  playCue: (cue: SoundCue) => Promise<boolean>;
  /** Play a sequence of cues back to back. */
  playCues: (cues: SoundCue[]) => Promise<boolean>;
  /** True while any clip is being fetched or played. */
  playing: boolean;
  /** The cue currently being generated/played, for progress UI. */
  currentCue: SoundCue | null;
  /** Last failure, or null. */
  error: string | null;
  stop: () => void;
}

/**
 * Sound effects for Jarvis.
 *
 * Generation takes a moment (the model has to synthesise the clip), so callers
 * should await `play()` before handing the mic back — otherwise the bark gets
 * picked up by the recorder and transcribed as the user talking.
 *
 * Clips are cached server-side, so only the first bark of a given kind costs a
 * generation; everything after is a storage read.
 */
export function useSoundEffects(): SoundEffects {
  const generate = useAction(api.voice.soundEffect);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentCue, setCurrentCue] = useState<SoundCue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.onended = null;
      el.onerror = null;
      el.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlaying(false);
    setCurrentCue(null);
  }, []);

  const playCue = useCallback(
    async (cue: SoundCue): Promise<boolean> => {
      setError(null);
      // A user gesture is the only reliable moment to arm audio output.
      void unlockAudioElement();

      setPlaying(true);
      setCurrentCue(cue);
      try {
        const { audio, error: serverError } = await generate({
          prompt: cue.prompt,
          duration: cue.duration,
        });

        if (serverError) {
          setError(serverError);
          return false;
        }
        if (!audio) {
          setError("That sound could not be generated.");
          return false;
        }

        stop();
        const url = URL.createObjectURL(
          new Blob([audio], { type: audioMimeType(audio) }),
        );
        urlRef.current = url;
        const el = new Audio(url);
        el.preload = "auto";
        el.volume = 1;
        audioRef.current = el;
        setCurrentCue(cue);
        setPlaying(true);

        await new Promise<void>((resolve, reject) => {
          el.onended = () => resolve();
          el.onerror = () => reject(new Error("playback failed"));
          void el.play().catch(reject);
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not play that sound.");
        return false;
      } finally {
        stop();
      }
    },
    [generate, stop],
  );

  /**
   * Play a chain of cues one after another. A failure part-way through stops
   * the sequence rather than firing the remaining clips out of nowhere.
   */
  const playCues = useCallback(
    async (cues: SoundCue[]): Promise<boolean> => {
      if (cues.length === 0) return false;
      let played = false;
      for (const cue of cues) {
        const ok = await playCue(cue);
        if (!ok) break;
        played = true;
      }
      stop();
      return played;
    },
    [playCue, stop],
  );

  const play = useCallback(
    (text: string) => playCues(findSoundCues(text)),
    [playCues],
  );

  return { play, playCue, playCues, playing, currentCue, error, stop };
}
