// ---------------------------------------------------------------------------
// useListeningQueue — read a whole conversation aloud, from any point.
//
// Per-message playback already existed, which is fine for "say this one" and
// useless for "read me the rest of this". A thread is the unit people actually
// want to listen to, and hopping between messages to press play eight times is
// how you stop listening at all.
//
// Three things make it feel like a player rather than a loop:
//
//   - The TTS action owns the markup stripping, so this only has to decide what
//     to say next. A reply that is nothing but code yields no audio and is
//     skipped silently rather than read as "(code omitted)" eight times.
//   - Each message is fetched only when its turn comes, so starting a long
//     thread costs one request, not twenty.
//   - A provider failure skips that message instead of ending the queue. One
//     unratelimited turn should not silence the rest of the conversation.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { audioMimeType } from "@/lib/audio";

export interface QueueItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ListeningQueue {
  active: boolean;
  /** The message being spoken, so the transcript can highlight it. */
  currentId: string | null;
  /** Messages still to come, including the current one. */
  remaining: number;
  error: string | null;
  /** Start reading from this message to the end of the thread. */
  start: (fromId: string) => void;
  stop: () => void;
}

export interface ListeningQueueOptions {
  items: QueueItem[];
  /**
   * Turns text into audio, or null when the provider has nothing to say.
   * Supplied by the caller so this hook stays independent of which TTS action,
   * voice or region settings are in play.
   */
  speak: (text: string) => Promise<ArrayBuffer | null>;
  /** BCP-47 tag for the browser fallback voice. */
  langTag?: string;
}

export function useListeningQueue({
  items,
  speak,
  langTag,
}: ListeningQueueOptions): ListeningQueue {
  const [active, setActive] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Everything the async walk touches lives in refs: the walk outlives any
  // single render, and closing over stale props would resume a queue the user
  // has already navigated away from.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const langRef = useRef(langTag);
  langRef.current = langTag;

  const cursorRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const tokenRef = useRef(0);

  const teardown = useCallback(() => {
    // Bumping the token orphans the in-flight walk: every await checks it and
    // returns, so a stop mid-synthesis cannot be overtaken by its result.
    tokenRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    window.speechSynthesis?.cancel();
  }, []);

  const finish = useCallback(() => {
    teardown();
    setActive(false);
    setCurrentId(null);
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  const walk = useCallback(async () => {
    const token = tokenRef.current;

    for (;;) {
      if (tokenRef.current !== token) return;

      const list = itemsRef.current;
      if (cursorRef.current >= list.length) {
        finish();
        return;
      }

      const item = list[cursorRef.current];
      cursorRef.current += 1;
      setCurrentId(item.id);

      let audio: ArrayBuffer | null = null;
      try {
        audio = await speakRef.current(item.content);
      } catch {
        // A provider that is rate limited for one message should not silence
        // the rest of the thread.
        continue;
      }
      if (tokenRef.current !== token) return;

      if (!audio) {
        // No server voice answered. Fall back to the browser's own synthesiser
        // so the queue still moves rather than stalling on a silent message.
        const synth = window.speechSynthesis;
        if (!synth || !item.content.trim()) continue;
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(item.content);
          if (langRef.current) utterance.lang = langRef.current;
          const done = () => {
            synth.removeEventListener("end", done);
            synth.removeEventListener("error", done);
            resolve();
          };
          synth.addEventListener("end", done);
          synth.addEventListener("error", done);
          synth.speak(utterance);
        });
        continue;
      }

      const ended = await new Promise<boolean>((resolve) => {
        const url = URL.createObjectURL(
          new Blob([audio], { type: audioMimeType(audio) }),
        );
        urlRef.current = url;
        const el = new Audio(url);
        audioRef.current = el;
        el.onended = () => resolve(true);
        el.onerror = () => resolve(false);
        void el.play().catch(() => resolve(false));
      });

      if (tokenRef.current !== token) return;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      audioRef.current = null;

      // A clip that failed to play still advances: retrying the same message
      // forever would be worse than skipping it.
      if (!ended) continue;
    }
  }, [finish]);

  const start = useCallback(
    (fromId: string) => {
      const index = itemsRef.current.findIndex((m) => m.id === fromId);
      if (index === -1) return;
      teardown();
      cursorRef.current = index;
      setError(null);
      setActive(true);
      void walk();
    },
    [teardown, walk],
  );

  const stop = useCallback(() => {
    finish();
  }, [finish]);

  return {
    active,
    currentId,
    remaining: active
      ? Math.max(0, itemsRef.current.length - cursorRef.current + 1)
      : 0,
    error,
    start,
    stop,
  };
}