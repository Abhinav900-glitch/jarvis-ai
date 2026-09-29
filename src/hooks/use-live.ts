import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { getCountry } from "@/lib/languages";
import { sanitizeForSpeech, speechChunks, speechSentences } from "@/lib/speech";
import {
  audioMimeType,
  startThinkingHum,
  stopThinkingHum,
  unlockAudioElement,
} from "@/lib/audio";

// ---------------------------------------------------------------------------
// useLiveMode — hands-free voice conversation (ChatGPT / Gemini Live style)
//
// Architecture (fully free stack, per the Groq voice pipeline):
//   1. Hearing: the mic runs continuously. Voice activity detection waits for
//      you to *start* speaking, then for you to *finish* (a short pause) —
//      only then is the clip cut and sent to Groq Whisper
//      (whisper-large-v3) for a near-instant transcript. Multilingual —
//      Hindi, Russian, Arabic, and 90+ languages, guided by the selected
//      country.
//   2. Thinking: the transcript goes through the normal chat pipeline
//      (Groq LLM with automatic fallback).
//   3. Speaking: the reply is spoken via ElevenLabs / Groq neural TTS, then
//      the browser's Web Speech voice, with a voice matched to the selected
//      country's language.
//
// Extras:
//   • Barge-in / natural interruption: mic volume is monitored while Jarvis
//     talks — if you speak over him, speech is cancelled instantly and he
//     listens again.
//   • Auto-restart: after each reply, listening resumes automatically, so the
//     conversation keeps flowing hands-free.
// ---------------------------------------------------------------------------

export interface LiveMode {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  processing: boolean;
  /** Live mic level 0..1 — drives the orb pulse */
  level: number;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Skip the reply currently being spoken and listen again immediately. */
  skipSpeaking: () => void;
  /** Feed Jarvis's reply text — spoken aloud, then listening resumes. */
  deliverReply: (text: string) => void;
}

/**
 * Turn handler: receives the recorded audio + country code, must run the
 * STT → LLM → append pipeline and return the reply text for speaking.
 */
export type LiveTurnHandler = (audio: Blob, countryCode: string) => Promise<string>;

const SILENCE_DB = 0.045; // RMS threshold for barge-in detection

// --- Turn endpointing -------------------------------------------------------
// This is what makes live mode behave like a ChatGPT / Gemini voice call: the
// mic never stops, we wait for you to begin a statement, then wait for you to
// finish it, and only then cut the clip and send it for transcription. Without
// it the recorder would run forever and Jarvis would never get a turn.
const SPEECH_RMS = 0.022; // above this level the user counts as speaking
const TURN_END_SILENCE_MS = 750; // pause in speech that ends the turn
// Short utterances matter: "hello", "thanks", "yes" are real turns. Gate on
// genuine *voiced* time (not wall clock, which would include the trailing
// pause) so a one-word greeting is accepted while blips still are not.
const MIN_VOICED_MS = 180; // ignore blips shorter than this (cough, door)
const MIN_CLIP_BYTES = 500; // floor for a decodable webm frame
const MAX_TURN_MS = 20_000; // hard cap so a monologue can't record forever



export function useLiveMode(
  onTurn: LiveTurnHandler,
  countryCode: string,
  voicePref?: { speaker?: string; voice?: string; pace?: number },
): LiveMode {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const processingRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;
  const countryRef = useRef(countryCode);
  countryRef.current = countryCode;
  // Voice selection lives in the composer; live mode just follows it.
  const voicePrefRef = useRef(voicePref);
  voicePrefRef.current = voicePref;
  const speakTts = useAction(api.voice.speak);

  // Recording machinery
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const bargeInRef = useRef(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  // Resolver for the in-flight playback promise. `pause()` does not fire an
  // `ended` event, so an explicit stop (barge-in / Skip) has to settle it —
  // otherwise the turn never finishes and the mic never resumes.
  const ttsSettleRef = useRef<(() => void) | null>(null);
  const humTimerRef = useRef<number | null>(null);
  // Voice-activity state for turn endpointing
  const speechStartRef = useRef<number | null>(null);
  const lastLoudRef = useRef<number | null>(null);
  const quietStartRef = useRef<number | null>(null);
  // stopRecording is declared after the level monitor, so the monitor calls
  // it through a ref to avoid a stale closure.
  const stopRecordingRef = useRef<() => void>(() => {});

  /** Stop server TTS playback instantly (barge-in / skip / session end). */
  const stopTtsAudio = useCallback(() => {
    const el = ttsAudioRef.current;
    if (el) {
      el.pause();
      el.onended = null;
      el.onerror = null;
      el.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    const settle = ttsSettleRef.current;
    ttsSettleRef.current = null;
    settle?.();
  }, []);

  const country = getCountry(countryCode);

  /**
   * Prime audio output for the rest of the session. Must be called from inside
   * the user gesture that starts live mode: it resumes the AudioContext (iOS
   * starts it suspended) and plays a moment of silence through an <audio>
   * element, which is what lets us start playback later without a gesture.
   */
  const unlockAudio = useCallback(async () => {
    try {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state === "suspended") await ctx.resume();
    } catch {
      /* resume is best-effort */
    }
    await unlockAudioElement();
  }, []);

  // ------------------------------------------------------------------
  // Mic level monitoring
  //   • while speaking → barge-in (interrupt Jarvis by talking over him)
  //   • while listening → voice-activity turn endpointing: detect that the
  //     user started a statement, and cut the clip once they pause at the end
  //     of it, so Whisper transcribes the complete thought.
  // ------------------------------------------------------------------
  const startLevelMonitor = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!activeRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));

      if (speakingRef.current) {
        // While Jarvis speaks, watch for the user talking over him
        if (rms > SILENCE_DB) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current > 350) {
            // 350ms of sustained voice → interrupt
            bargeInRef.current = true;
            window.speechSynthesis.cancel();
            stopTtsAudio();
          }
        } else {
          silenceStartRef.current = null;
        }
      } else if (recorderRef.current?.state === "recording") {
        // Listening: track speech start / end to close the turn.
        if (rms > SPEECH_RMS) {
          const now = Date.now();
          if (speechStartRef.current === null) speechStartRef.current = now;
          lastLoudRef.current = now; // most recent voiced frame
          quietStartRef.current = null; // still talking — reset the pause timer
        } else if (speechStartRef.current !== null) {
          if (quietStartRef.current === null) {
            quietStartRef.current = Date.now();
          } else if (Date.now() - quietStartRef.current > TURN_END_SILENCE_MS) {
            // The user paused after speaking → end of turn, send it.
            stopRecordingRef.current();
          }
        }
        // Hard cap so a long monologue can't record forever.
        if (
          speechStartRef.current !== null &&
          Date.now() - speechStartRef.current > MAX_TURN_MS
        ) {
          stopRecordingRef.current();
        }
      }
      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
  }, [stopTtsAudio]);

  const stopLevelMonitor = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setLevel(0);
  }, []);

  // ------------------------------------------------------------------
  // Recording → Whisper STT
  // ------------------------------------------------------------------
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || speakingRef.current || processingRef.current || !activeRef.current) return;
    // Never stack two recorders on the same stream.
    if (recorderRef.current?.state === "recording") return;

    try {
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        // Voiced time = last loud frame - first loud frame. Using the wall
        // clock here would fold the trailing pause into the number and let
        // every blip through, which is why short greetings were unreliable.
        const voicedMs =
          speechStartRef.current && lastLoudRef.current
            ? lastLoudRef.current - speechStartRef.current
            : 0;
        // Reset endpointing state for the next turn.
        speechStartRef.current = null;
        lastLoudRef.current = null;
        quietStartRef.current = null;

        // Reject clips that held no real speech (a blip, or a recorder we cut
        // off before the user said anything) and just keep listening.
        if (blob.size < MIN_CLIP_BYTES || voicedMs < MIN_VOICED_MS || !activeRef.current) {
          window.setTimeout(() => startRecording(), 300);
          return;
        }
        processingRef.current = true;
        setProcessing(true);
        // Don't fill a short gap with hum, only a real pause — a 200ms blip
        // would just click.
        humTimerRef.current = window.setTimeout(() => {
          if (processingRef.current) startThinkingHum();
        }, 420);
        try {
          await onTurnRef.current(blob, countryRef.current);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          if (humTimerRef.current !== null) {
            window.clearTimeout(humTimerRef.current);
            humTimerRef.current = null;
          }
          stopThinkingHum();
          processingRef.current = false;
          setProcessing(false);
          // Resume listening after the turn completes (reply delivery also
          // triggers resume via deliverReply → utterance end)
          if (!speakingRef.current && activeRef.current) {
            window.setTimeout(() => startRecording(), 400);
          }
        }
      };
      rec.start();
      recorderRef.current = rec;
      speechStartRef.current = null;
      lastLoudRef.current = null;
      quietStartRef.current = null;
      setListening(true);
      setError(null);
    } catch {
      setError("Could not start recording.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setListening(false);
  }, []);

  // The level monitor (declared above) closes turns by calling this.
  stopRecordingRef.current = stopRecording;

  // ------------------------------------------------------------------
  // Speak a reply via browser TTS with a country-matched voice
  // ------------------------------------------------------------------
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices();
    const tag = countryRef.current ? getCountry(countryRef.current).langTag : "en-US";
    const langPrefix = tag.split("-")[0];
    return (
      voices.find((v) => v.lang === tag) ??
      voices.find((v) => v.lang.startsWith(langPrefix)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null
    );
  }, []);

  // Browser speech synthesis fallback (sentence-chunked so barge-in cancels fast)
  const speakWithBrowser = useCallback(
    (spoken: string, onDone: () => void) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        onDone();
        return;
      }
      const sentences = speechSentences(spoken);
      const utterances = sentences.map((s) => {
        const u = new SpeechSynthesisUtterance(s.trim());
        const voice = pickVoice();
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = countryRef.current ? getCountry(countryRef.current).langTag : "en-US";
        }
        u.rate = 1.05;
        return u;
      });
      utterances.forEach((u, i) => {
        u.onstart = () => {
          speakingRef.current = true;
          setSpeaking(true);
        };
        u.onend = () => {
          const isLast = i === utterances.length - 1;
          if (bargeInRef.current || isLast) onDone();
        };
        u.onerror = () => onDone();
        synth.speak(u);
      });
      if (utterances.length === 0) onDone();
    },
    [pickVoice],
  );

  // Speak a reply: Groq neural TTS (server) first, browser voice as fallback.
  const speakReply = useCallback(
    (text: string, onDone: () => void) => {
      // Speak the message, never the markup: strip markdown, math, code and
      // links so Jarvis doesn't read "hash", "pipe" or a raw URL aloud. The
      // same sanitizer runs again inside the `speak` action, so every server
      // provider (Groq, ElevenLabs) receives the same clean prose.
      const spoken = sanitizeForSpeech(text);
      if (!spoken) {
        onDone();
        return;
      }

      window.speechSynthesis?.cancel();
      bargeInRef.current = false;
      silenceStartRef.current = null;

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speakingRef.current = false;
        setSpeaking(false);
        onDone();
      };

      void (async () => {
        try {
          // Play the reply chunk by chunk. A synthesiser needs a second or
          // two per request, so sending the whole reply in one call means
          // silence until the very end. Instead the first chunk is generated
          // immediately and the next one is requested *while the current one
          // plays*, so the speech comes out nearly continuously.
          const chunks = speechChunks(spoken);
          const langTag = getCountry(countryRef.current).langTag;

          const playClip = async (audio: ArrayBuffer): Promise<void> => {
            // Play through an <audio> element rather than a bare
            // AudioBufferSourceNode: the element decodes WAV and MP3 for us
            // (the action returns either, depending on the provider), routes
            // to the phone's media channel — so the ringer/silent switch
            // doesn't swallow Jarvis — and gives us reliable play() rejection
            // to fall back on.
            stopTtsAudio();
            const url = URL.createObjectURL(
              new Blob([audio], { type: audioMimeType(audio) }),
            );
            ttsUrlRef.current = url;
            const el = new Audio(url);
            el.preload = "auto";
            el.volume = 1;
            ttsAudioRef.current = el;

            speakingRef.current = true;
            setSpeaking(true);

            await new Promise<void>((resolve, reject) => {
              const settleOnce = (fn: () => void) => {
                ttsSettleRef.current = null;
                fn();
              };
              // An explicit stop (barge-in / Skip) has to settle this too:
              // pause() does not fire `ended`, and a hung turn would never
              // hand the mic back.
              ttsSettleRef.current = () => settleOnce(resolve);
              el.onended = () => settleOnce(resolve);
              el.onerror = () => settleOnce(() => reject(new Error("playback failed")));
              void el.play().catch((err) => settleOnce(() => reject(err)));
            });
          };

          if (chunks.length === 0) {
            finish();
            return;
          }

          // Always keep one generation in flight ahead of playback.
          let pending: ReturnType<typeof speakTts> = speakTts({
            text: chunks[0],
            langTag,
            ...(voicePrefRef.current?.speaker
              ? { speaker: voicePrefRef.current.speaker }
              : {}),
            ...(voicePrefRef.current?.voice
              ? { voice: voicePrefRef.current.voice }
              : {}),
            ...(voicePrefRef.current?.pace
              ? { pace: voicePrefRef.current.pace }
              : {}),
          });

          // Leaving the loop early abandons an in-flight generation; swallow
          // its rejection instead of leaking an unhandled promise.
          const abandon = () => {
            void pending.catch(() => {});
          };

          for (let i = 0; i < chunks.length; i++) {
            const { audio } = await pending;
            // Start the next generation now, during this chunk's playback.
            if (i + 1 < chunks.length) {
              pending = speakTts({
                text: chunks[i + 1],
                langTag,
                ...(voicePrefRef.current?.speaker
                  ? { speaker: voicePrefRef.current.speaker }
                  : {}),
                ...(voicePrefRef.current?.voice
                  ? { voice: voicePrefRef.current.voice }
                  : {}),
                ...(voicePrefRef.current?.pace
                  ? { pace: voicePrefRef.current.pace }
                  : {}),
              });
            }
            if (bargeInRef.current || !activeRef.current) {
              abandon();
              // finish() is mandatory here: without it the turn never closes
              // and the mic is never handed back — live mode would hang.
              finish();
              return;
            }
            if (!audio) {
              // A provider died mid-reply: let the browser voice finish it.
              stopTtsAudio();
              speakWithBrowser(chunks.slice(i).join(" "), finish);
              return;
            }
            await playClip(audio);
            if (bargeInRef.current || !activeRef.current) {
              abandon();
              finish();
              return;
            }
          }
          finish();
        } catch {
          // Fallback: browser speech synthesis. Stop whatever is playing
          // first, or the failed clip and the fallback talk over each other.
          stopTtsAudio();
          speakWithBrowser(spoken, finish);
        }
      })();
    },
    [speakTts, speakWithBrowser, stopTtsAudio],
  );

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setListening(false);
    setProcessing(false);
    speakingRef.current = false;
    setSpeaking(false);
    stopLevelMonitor();
    stopThinkingHum();
    if (humTimerRef.current !== null) {
      window.clearTimeout(humTimerRef.current);
      humTimerRef.current = null;
    }
    window.speechSynthesis?.cancel();
    stopTtsAudio();
    stopRecording();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, [stopLevelMonitor, stopRecording, stopTtsAudio]);

  const start = useCallback(async () => {
    setError(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Live mode needs a secure connection — open this app over HTTPS.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice isn't supported in this browser.");
      return;
    }
    if (!("speechSynthesis" in window)) {
      setError("Speech output isn't supported in this browser.");
      return;
    }

    try {
      // Create and resume the AudioContext FIRST, while the user gesture that
      // started live mode is still live — iOS hands back a suspended context
      // otherwise, and the getUserMedia await below would break the chain.
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      await unlockAudio();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up the analyser for level monitoring + barge-in
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      activeRef.current = true;
      setActive(true);
      startLevelMonitor();
      startRecording();
    } catch {
      setError("Microphone access denied. Allow mic access and retry.");
    }
  }, [startLevelMonitor, startRecording, unlockAudio]);

  /** Skip the current spoken reply and go straight back to listening. */
  const skipSpeaking = useCallback(() => {
    if (!activeRef.current) return;
    bargeInRef.current = false;
    speakingRef.current = false;
    setSpeaking(false);
    window.speechSynthesis?.cancel();
    stopTtsAudio(); // server TTS (ElevenLabs / Groq) audio buffer
    if (processingRef.current) return;
    window.setTimeout(() => startRecording(), 150);
  }, [stopTtsAudio, startRecording]);

  const deliverReply = useCallback(
    (text: string) => {
      if (!activeRef.current) return;
      if (!text.trim()) {
        if (!speakingRef.current) window.setTimeout(() => startRecording(), 300);
        return;
      }
      // Pause the mic while Jarvis talks
      stopRecording();
      speakReply(text, () => {
        if (activeRef.current && !bargeInRef.current) {
          window.setTimeout(() => startRecording(), 400);
        } else if (bargeInRef.current) {
          // Interrupted — listen again immediately
          bargeInRef.current = false;
          window.setTimeout(() => startRecording(), 150);
        }
      });
    },
    [speakReply, startRecording, stopRecording],
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      activeRef.current = false;
      window.speechSynthesis?.cancel();
      stopTtsAudio();
      stopThinkingHum();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current);
    },
    [stopTtsAudio],
  );

  return {
    active,
    listening,
    speaking,
    processing,
    level,
    error,
    start,
    stop,
    skipSpeaking,
    deliverReply,
  };
}
