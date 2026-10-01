/**
 * `useLiveSession` — the React binding for the local live voice + vision
 * pipeline.
 *
 * It owns the lifecycle of the four long-lived resources (mic, vision,
 * transport, playback) and exposes a single state object to the UI.
 *
 * Interruption handling lives here: when the server sends CLEAR_BUFFER the
 * hook flushes the playback worklet immediately, so the assistant stops
 * mid-sentence rather than finishing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { IDENTITY_INSTRUCTIONS } from "@/lib/identity";
import { MANNERS_RULES } from "@/lib/emotional-intelligence";
import { MicCapture } from "./audio";
import { TtsPlayback } from "./playback";
import { LiveTransport, type ConnectionStatus } from "./transport";
import { VisionCapture, type VisionSource } from "./vision";
import { CTRL, type SessionState } from "./protocol";

export interface LiveTurn {
  id: number;
  user: string;
  assistant: string;
  truncated: boolean;
}

export interface LiveSessionOptions {
  /** WebSocket URL of the local pipeline. */
  url?: string;
  /** ISO-639-1 language hint, e.g. "en". Omit for auto-detect. */
  language?: string;
  /**
   * Extra system instructions for the local model, sent once at session start.
   *
   * The local pipeline has no idea who built this application, so without this
   * it will name whichever lab trained it when asked. Defaults to the shared
   * identity block so the usual case needs no configuration.
   */
  instructions?: string | null;
  /** Send camera frames to the model. */
  vision?: boolean;
  visionSource?: VisionSource;
  visionFps?: number;
}

export interface LiveSessionState {
  status: ConnectionStatus;
  state: SessionState;
  active: boolean;
  micLevel: number;
  userSpeaking: boolean;
  assistantSpeaking: boolean;
  partialTranscript: string;
  turns: LiveTurn[];
  error: string | null;
  visionActive: boolean;
}

const DEFAULT_URL = "ws://127.0.0.1:8787/ws/live";

export function useLiveSession(options: LiveSessionOptions = {}) {
  const {
    url = DEFAULT_URL,
    language,
    vision = false,
    visionSource = "camera",
    visionFps = 1.5,
  } = options;

  // Defaulted rather than left undefined: the whole point of sending these is
  // that the local model otherwise has no idea who built this application, so
  // the default is the case worth having.
  // The manners rules travel with the identity block by default. Live mode talks
  // through a local model with its own system prompt, so without them it has no
  // idea how it is expected to speak — and "no manners rules" reads as curt.
  const instructions =
    options.instructions ?? `${IDENTITY_INSTRUCTIONS}\n\n${MANNERS_RULES}`;

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [state, setState] = useState<SessionState>("idle");
  const [active, setActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visionActive, setVisionActive] = useState(false);

  const micRef = useRef<MicCapture | null>(null);
  const visionRef = useRef<VisionCapture | null>(null);
  const playbackRef = useRef<TtsPlayback | null>(null);
  const transportRef = useRef<LiveTransport | null>(null);
  const turnIdRef = useRef(0);
  const activeRef = useRef(false);

  // Keep the latest options available to callbacks without re-creating
  // the transport on every render.
  //
  // Synced in an effect rather than during render: writing a ref while rendering
  // is what the react-hooks/refs rule forbids, and every read of this ref happens
  // in a callback or socket handler, which runs well after effects have flushed.
  const optionsRef = useRef({ language, vision, visionSource, visionFps, instructions });
  useEffect(() => {
    optionsRef.current = { language, vision, visionSource, visionFps, instructions };
  });

  const handleClearBuffer = useCallback(() => {
    // Barge-in: drop queued audio on the audio thread immediately.
    playbackRef.current?.flush();
    setAssistantSpeaking(false);
  }, []);

  const handleControl = useCallback(
    (message: { type: string; [key: string]: unknown }) => {
      switch (message.type) {
        case CTRL.STATE:
          setState((message.state as SessionState) ?? "idle");
          break;

        case CTRL.TRANSCRIPT_PARTIAL:
          setPartialTranscript(String(message.text ?? ""));
          break;

        case CTRL.TRANSCRIPT_FINAL: {
          const text = String(message.text ?? "");
          setPartialTranscript("");
          turnIdRef.current += 1;
          const id = turnIdRef.current;
          setTurns((prev) => {
            const last = prev[prev.length - 1];
            // Merge into the open turn when the user spoke again mid-reply.
            if (last && last.assistant === "" && !last.truncated) {
              return [...prev.slice(0, -1), { ...last, user: last.user || text }];
            }
            return [...prev, { id, user: text, assistant: "", truncated: false }];
          });
          break;
        }

        case CTRL.RESPONSE_DELTA: {
          const delta = String(message.text ?? "");
          setTurns((prev) => {
            if (prev.length === 0) {
              turnIdRef.current += 1;
              return [
                { id: turnIdRef.current, user: "", assistant: delta, truncated: false },
              ];
            }
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, assistant: last.assistant + delta }];
          });
          break;
        }

        case CTRL.RESPONSE_DONE: {
          const truncated = Boolean(message.truncated);
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, truncated }];
          });
          playbackRef.current?.markEnd();
          break;
        }

        case CTRL.CLEAR_BUFFER:
          handleClearBuffer();
          break;

        case CTRL.ERROR:
          setError(String(message.message ?? "Pipeline error"));
          break;

        default:
          break;
      }
    },
    [handleClearBuffer],
  );

  const createTransport = useCallback(
    (target: string) =>
      new LiveTransport(target, {
        onStatus: setStatus,
        onControl: handleControl,
        onAudio: (pcm, isFinal) => {
          if (pcm.byteLength > 0) {
            playbackRef.current?.enqueue(pcm);
            setAssistantSpeaking(true);
          }
          if (isFinal) {
            playbackRef.current?.markEnd();
          }
        },
        onReady: (outSampleRate) => {
          void playbackRef.current?.start().then(() => undefined);
          void outSampleRate;
        },
      }),
    [handleControl],
  );

  const stopResources = useCallback(async () => {
    await Promise.allSettled([
      micRef.current?.stop() ?? Promise.resolve(),
      visionRef.current?.stop() ?? Promise.resolve(),
      playbackRef.current?.stop() ?? Promise.resolve(),
    ]);
    micRef.current = null;
    visionRef.current = null;
    playbackRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setError(null);
    setTurns([]);

    try {
      // Playback must exist before audio arrives; created suspended and
      // resumed on the first ready frame.
      const playback = new TtsPlayback({
        onPlayingChange: setAssistantSpeaking,
      });
      playbackRef.current = playback;
      await playback.start();

      const mic = new MicCapture({
        onFrame: (pcm) => {
          transportRef.current?.sendAudio(pcm);
        },
        onLevel: setMicLevel,
        onSpeech: setUserSpeaking,
        onError: (err) => setError(err.message),
      });
      micRef.current = mic;
      await mic.start();

      if (optionsRef.current.vision) {
        const visionCapture = new VisionCapture({
          source: optionsRef.current.visionSource,
          fps: optionsRef.current.visionFps,
          onFrame: (jpeg) => {
            transportRef.current?.sendImage(jpeg);
          },
          onError: (err) => setError(err.message),
        });
        visionRef.current = visionCapture;
        await visionCapture.start();
        setVisionActive(true);
      }

      const transport = createTransport(url);
      // Set before connect(): the socket opens asynchronously and sends
      // session.start from its onopen, so anything set afterwards would arrive
      // too late to be included.
      transport.setInstructions(optionsRef.current.instructions);
      transportRef.current = transport;
      transport.connect();

      setActive(true);
    } catch (err) {
      activeRef.current = false;
      setActive(false);
      setError(err instanceof Error ? err.message : "Could not start live mode.");
      await stopResources();
    }
  }, [createTransport, stopResources, url]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    setActive(false);
    setState("idle");
    setUserSpeaking(false);
    setAssistantSpeaking(false);
    setPartialTranscript("");
    setMicLevel(0);
    setVisionActive(false);

    transportRef.current?.close();
    transportRef.current = null;
    await stopResources();
  }, [stopResources]);

  const toggleVision = useCallback(async () => {
    if (visionRef.current) {
      await visionRef.current.stop();
      visionRef.current = null;
      setVisionActive(false);
      return;
    }
    if (!activeRef.current) return;
    const capture = new VisionCapture({
      source: optionsRef.current.visionSource,
      fps: optionsRef.current.visionFps,
      onFrame: (jpeg) => {
        transportRef.current?.sendImage(jpeg);
      },
      onError: (err) => setError(err.message),
    });
    try {
      await capture.start();
      visionRef.current = capture;
      setVisionActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the camera.");
    }
  }, []);

  /** Stop the assistant mid-sentence and go back to listening. */
  const interrupt = useCallback(() => {
    handleClearBuffer();
    transportRef.current?.interrupt();
    setState("listening");
  }, [handleClearBuffer]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Stop any in-flight speech so typed input is heard immediately.
    handleClearBuffer();
    transportRef.current?.sendText(trimmed);
  }, [handleClearBuffer]);

  const clearError = useCallback(() => setError(null), []);

  // Tear everything down if the component unmounts mid-session.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      transportRef.current?.close();
      void stopResources();
    };
  }, [stopResources]);

  return {
    status,
    state,
    active,
    micLevel,
    userSpeaking,
    assistantSpeaking,
    partialTranscript,
    turns,
    error,
    visionActive,
    start,
    stop,
    interrupt,
    sendText,
    toggleVision,
    clearError,
  };
}

export type LiveSession = ReturnType<typeof useLiveSession>;
