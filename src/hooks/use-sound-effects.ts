import { useCallback, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { audioMimeType, unlockAudioElement } from "@/lib/audio";
import { type SoundCue, matchSoundCue } from "@/lib/sound-effects";

export interface SoundEffects {
  /** Play the cue a message is asking for. Resolves true when audio played. */
  play: (textOrCue: string | SoundCue) => Promise<boolean>;
  /** Play a cue by id from the catalog. */
  playCue: (cue: SoundCue) => Promise<boolean>;
  /** True while a clip is being fetched and played. */
  playing: boolean;
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
  }, []);

  const playCue = useCallback(
    async (cue: SoundCue): Promise<boolean> => {
      setError(null);
      // A user gesture is the only reliable moment to arm audio output.
      void unlockAudioElement();

      setPlaying(true);
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

  const play = useCallback(
    (textOrCue: string | SoundCue) => {
      const cue =
        typeof textOrCue === "string" ? matchSoundCue(textOrCue) : textOrCue;
      if (!cue) return Promise.resolve(false);
      return playCue(cue);
    },
    [playCue],
  );

  return { play, playCue, playing, error, stop };
}
