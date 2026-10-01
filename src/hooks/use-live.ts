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
import { prepareVoiceClip, type Mood } from "@/lib/voice-mood";

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

const BARGE_IN_HOLD_MS = 350; // sustained voice needed to interrupt Jarvis

// --- Turn endpointing -------------------------------------------------------
// This is what makes live mode behave like a ChatGPT / Gemini voice call: the
// mic never stops, we wait for you to begin a statement, then wait for you to
// finish it, and only then cut the clip and send it for transcription. Without
// it the recorder would run forever and Jarvis would never get a turn.
// --- Adaptive voice activity ------------------------------------------------
// A single fixed RMS gate works in a quiet room and fails everywhere else. In a
// café the background sits above the gate, so every turn ends on a fridge hum
// and barge-ins fire at nothing; in a silent room a soft voice never clears it
// and live mode simply looks dead. So the gate tracks the room instead: a slow
// EMA of the quietest recent frames becomes the floor, and speech has to clear
// that floor by a margin.
const NOISE_FLOOR_MIN = 0.004; // don't chase digital silence
const NOISE_FLOOR_MAX = 0.06; // don't let a sustained loud passage become the floor
const NOISE_FALL_RATE = 0.05; // fast to fall once a loud passage ends
const NOISE_RISE_RATE = 0.002; // very slow to rise, so speech never raises the floor
const ABS_FLOOR = 0.011; // absolute gate for an already-silent room
const SPEECH_SNR = 3.2; // must clear the measured floor by this factor to start
const RELEASE_SNR = 1.9; // lower bar to keep counting as speech (hysteresis)
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
  /** BCP-47 tag to synthesise in, when it should override the country default. */
  speechLangTag?: string | null,
): LiveMode {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // "Latest value" refs. These are read from long-lived callbacks (mic
  // timers, media event handlers) that must not be re-created on every render,
  // so they are synced in an effect below rather than assigned during render —
  // assigning a ref while rendering is unsafe under concurrent rendering.
  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const processingRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  const countryRef = useRef(countryCode);
  // Voice selection lives in the composer; live mode just follows it.
  const voicePrefRef = useRef(voicePref);
  // Live translation target. Null (the default) means "speak in the country
  // language"; a tag means the reply was translated and needs a matching
  // voice on both the server TTS call and the browser fallback.
  const speechLangRef = useRef<string | null>(speechLangTag ?? null);
  // How the user's last turn sounded. Read by the TTS call so Jarvis's
  // delivery can answer the tone he was given — a steady voice to someone
  // who sounded wound up, rather than matching their agitation.
  const moodRef = useRef<Mood | null>(null);
  const speakTts = useAction(api.voice.speak);

  // Recording machinery
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
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
  // Rolling measurement of the room's quiet level, so the speech gate can sit
  // above the background instead of at a hardcoded volume.
  const noiseFloorRef = useRef<number>(0.004);
  // stopRecording is declared after the level monitor, so the monitor calls
  // it through a ref to avoid a stale closure.
  const stopRecordingRef = useRef<() => void>(() => {});
  // Self-recursive restart: the clip handler re-arms the recorder after a
  // blip or a finished turn, so it goes through a ref rather than closing over
  // its own binding.
  const startRecordingRef = useRef<() => void>(() => {});

  // Keep the "latest value" refs in step with props/state after every commit.
  useEffect(() => {
    onTurnRef.current = onTurn;
    countryRef.current = countryCode;
    voicePrefRef.current = voicePref;
    speechLangRef.current = speechLangTag ?? null;
  });

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
    // Re-seed on every start so a session beginning in a noisy room does not
    // inherit the floor measured somewhere else.
    noiseFloorRef.current = NOISE_FLOOR_MIN;

    const tick = () => {
      if (!activeRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));

      // Track the room's quiet floor. It only falls quickly and rises almost
      // not at all, which is what keeps the user's own speech from being
      // absorbed into the background and the gate drifting upward.
      const floor = noiseFloorRef.current;
      const isQuieter = rms < floor;
      noiseFloorRef.current = Math.min(
        NOISE_FLOOR_MAX,
        Math.max(
          NOISE_FLOOR_MIN,
          floor + (rms - floor) * (isQuieter ? NOISE_FALL_RATE : NOISE_RISE_RATE),
        ),
      );

      // Two gates off the same floor: a higher one to declare speech, a lower
      // one to keep it declared. Without that gap the detector chatters on and
      // off inside a single word and cuts the turn mid-syllable.
      const base = Math.max(ABS_FLOOR, noiseFloorRef.current);
      const speechGate = base * SPEECH_SNR;
      const releaseGate = base * RELEASE_SNR;

      if (speakingRef.current) {
        // While Jarvis speaks, watch for the user talking over him
        if (rms > releaseGate) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current > BARGE_IN_HOLD_MS) {
            // Sustained voice → interrupt
            bargeInRef.current = true;
            window.speechSynthesis.cancel();
            stopTtsAudio();
          }
        } else {
          silenceStartRef.current = null;
        }
      } else if (recorderRef.current?.state === "recording") {
        // Listening: track speech start / end to close the turn.
        if (rms > speechGate) {
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
          window.setTimeout(() => startRecordingRef.current(), 300);
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
          // The recorder is always rolling, so this clip is padded with silence
          // on both sides. Trimming it cuts upload time and stops Whisper
          // hearing a silent lead-in as an invitation to hallucinate; the same
          // decode yields a rough read of how the user sounded.
          const { trimmed, mood } = await prepareVoiceClip(blob);
          moodRef.current = mood;
          await onTurnRef.current(trimmed, countryRef.current);
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
            window.setTimeout(() => startRecordingRef.current(), 400);
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
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  // ------------------------------------------------------------------
  // Speak a reply via browser TTS with a country-matched voice
  // ------------------------------------------------------------------
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices();
    // When live translation is on, the spoken text is in the target language,
    // so the voice must match that — not the country default.
    const tag =
      speechLangRef.current ??
      (countryRef.current ? getCountry(countryRef.current).langTag : "en-US");
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
          u.lang =
            speechLangRef.current ??
            (countryRef.current ? getCountry(countryRef.current).langTag : "en-US");
        }
        // Honour the pace the user picked in the composer. The server TTS
        // already respects it, so hardcoding a rate here made the fallback
        // voice ignore their choice.
        u.rate = voicePrefRef.current?.pace ?? 1.05;
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
          const langTag =
            speechLangRef.current ?? getCountry(countryRef.current).langTag;

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
            ...(moodRef.current ? { mood: moodRef.current } : {}),
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
                ...(moodRef.current ? { mood: moodRef.current } : {}),
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
