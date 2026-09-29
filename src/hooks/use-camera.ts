/**
 * Camera vision — strictly opt-in.
 *
 * Nothing here touches `getUserMedia` until the user turns the feature on.
 * The stream is requested only on enable, and every track is stopped on
 * disable and on unmount, so the camera light goes out the moment the user
 * turns it off (or navigates away).
 *
 * While enabled, `capture()` grabs a single downscaled JPEG from the current
 * video frame. Frames are only taken when the user actually sends a turn, not
 * on a timer — the camera is a passive sensor here, not a recorder.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Longest edge of the captured frame, in px. Small keeps uploads fast. */
const MAX_EDGE = 768;
const JPEG_QUALITY = 0.72;

export interface CameraState {
  /** True only while a video track is live. */
  enabled: boolean;
  starting: boolean;
  error: string | null;
  /** Attach to the <video> element that should show the preview. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The most recent captured frame as a data URL, or null. */
  lastFrame: string | null;
  enable: () => Promise<void>;
  disable: () => void;
  /** Returns a data URL of the current frame, or null if unavailable. */
  capture: () => string | null;
  toggle: () => Promise<void>;
}

/**
 * Stop every track on a stream. Written as a standalone so disable() and the
 * unmount cleanup cannot drift apart and leak a live camera.
 */
function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function useCamera(): CameraState {
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFrame, setLastFrame] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const disable = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setEnabled(false);
    setStarting(false);
    setError(null);
  }, []);

  const enable = useCallback(async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser has no camera support.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // Video only — audio stays off so Jarvis never has an open mic the
      // user did not ask for.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // Autoplay can still be blocked; muted+playsInline is the reliable
        // combination for a preview the user never explicitly plays.
        video.muted = true;
        video.playsInline = true;
        try {
          await video.play();
        } catch {
          // Preview may start a moment later once metadata loads.
        }
      }
      setEnabled(true);
    } catch (err) {
      stopStream(streamRef.current);
      streamRef.current = null;
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission denied — allow it in your browser to use vision."
          : name === "NotFoundError"
            ? "No camera found on this device."
            : "Could not start the camera.",
      );
    } finally {
      setStarting(false);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (streamRef.current) disable();
    else await enable();
  }, [disable, enable]);

  const capture = useCallback((): string | null => {
    const video = videoRef.current;
    if (!streamRef.current || !video || !video.videoWidth) return null;

    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    } catch {
      return null;
    }
    setLastFrame(dataUrl);
    return dataUrl;
  }, []);

  // Hard guarantee: the camera is released when the component goes away,
  // even if the user never hit the toggle off.
  useEffect(() => () => stopStream(streamRef.current), []);

  return {
    enabled,
    starting,
    error,
    videoRef,
    lastFrame,
    enable,
    disable,
    capture,
    toggle,
  };
}
