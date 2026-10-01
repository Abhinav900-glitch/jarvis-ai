/**
 * Hand tracking — a port of the open-source ULTRON tracker
 * (https://github.com/SAGAR-TAMANG/ultron-by-sagar-builds, MIT).
 *
 * Two changes from the original, both deliberate:
 *
 *  • It can ATTACH to an existing MediaStream. The original always calls
 *    getUserMedia itself, which in this app would mean a second camera
 *    competing with the one live mode already holds open for vision. Two
 *    getUserMedia calls on the same device fight over the hardware and are a
 *    common source of black frames.
 *  • It also reports discrete poses, not just pinch. ULTRON uses hands purely
 *    to spin and zoom the orb; here the same tracker drives Jarvis actions
 *    (see gesture-actions.ts), and it needs to know an open palm from a fist.
 */

import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { classifyHand, type Gesture } from "@/lib/gesture-actions";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

/** Pinch hysteresis. Two thresholds, not one, or it chatters at the edge. */
const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;

const ROTATE_SPEED = 5.0;
const SMOOTHING = 0.4;

export type GestureMode = "idle" | "spin" | "zoom";

export interface TrackerStatus {
  hands: number;
  mode: GestureMode;
  /** Pose of the primary hand, for action binding. */
  gesture: Gesture;
}

export interface HandTrackerCallbacks {
  onRotate(deltaTheta: number, deltaPhi: number): void;
  onZoom(factor: number): void;
  onStatus(status: TrackerStatus): void;
  onError?(error: Error): void;
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  grab: Point;
}

const dist2d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export class HandTracker {
  private readonly video: HTMLVideoElement;
  private readonly overlay: HTMLCanvasElement | null;
  private readonly callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;
  private handStates = new Map<string, HandState>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  private lastStatus: TrackerStatus = { hands: 0, mode: "idle", gesture: "idle" };
  /** True when we opened the camera ourselves and must therefore close it. */
  private ownsStream = false;

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement | null,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  /**
   * Start tracking.
   *
   * Pass `existingStream` to share a camera that is already open. When omitted
   * the tracker acquires its own, and `stop()` will release it.
   */
  async start(existingStream?: MediaStream | null): Promise<void> {
    try {
      if (existingStream) {
        this.video.srcObject = existingStream;
        this.ownsStream = false;
      } else {
        this.video.srcObject = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        this.ownsStream = true;
      }
      await this.video.play();

      const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
        runningMode: "VIDEO" as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      };

      try {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
      } catch {
        // Some browsers reject the GPU delegate; CPU is slower but works.
        this.landmarker = await HandLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
        });
      }

      this.running = true;
      this.loop();
    } catch (err) {
      // No camera, denied permission, or a blocked CDN. The orb keeps working
      // with mouse and touch, so this is a degraded mode, not a failure.
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error("Hand tracking unavailable."),
      );
      this.stop();
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    // Only release the camera if we opened it. A shared stream belongs to
    // live mode and must survive.
    if (this.ownsStream) {
      const stream = this.video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    }
    this.video.srcObject = null;
    this.handStates.clear();
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    const ctx = this.overlay?.getContext("2d");
    if (ctx && this.overlay) {
      ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }
    this.emitStatus({ hands: 0, mode: "idle", gesture: "idle" });
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker || this.video.readyState < 2) return;
    // detectForVideo is expensive; the camera often hands us the same frame
    // twice, and re-running inference on it changes nothing.
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.processHands(
      result.landmarks,
      result.handedness.map((h) => h[0]?.categoryName ?? "?"),
    );
    this.drawOverlay(result.landmarks);
  };

  private processHands(landmarks: NormalizedLandmark[][], labels: string[]): void {
    const pinchedGrabs: Point[] = [];
    const seen = new Set<string>();
    let primary: NormalizedLandmark[] | null = null;

    landmarks.forEach((lm, i) => {
      const label = labels[i];
      seen.add(label);
      // The first hand is the one actions bind to; prefer an unpinched one so
      // a pinch-drag does not also read as an action pose.
      if (!primary || (primary[INDEX_TIP].z ?? 0) > (lm[INDEX_TIP].z ?? 0)) {
        primary = lm;
      }

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;
      const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      // Mirrored so hand-right reads as screen-right for the user.
      const raw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };

      let state = this.handStates.get(label);
      if (!state) {
        state = { pinching: false, grab: raw };
        this.handStates.set(label, state);
      }

      if (state.pinching && pinchRatio > PINCH_OFF) state.pinching = false;
      else if (!state.pinching && pinchRatio < PINCH_ON) state.pinching = true;

      state.grab = {
        x: state.grab.x + (raw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (raw.y - state.grab.y) * SMOOTHING,
      };
      if (state.pinching) pinchedGrabs.push(state.grab);
    });

    for (const key of this.handStates.keys()) {
      if (!seen.has(key)) this.handStates.delete(key);
    }

    const mode: GestureMode =
      pinchedGrabs.length >= 2 ? "zoom" : pinchedGrabs.length === 1 ? "spin" : "idle";

    // Reset reference points on any mode change, or the first frame after a
    // switch emits a huge jump as a "delta".
    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          this.callbacks.onRotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        }
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      const d = Math.hypot(
        pinchedGrabs[0].x - pinchedGrabs[1].x,
        pinchedGrabs[0].y - pinchedGrabs[1].y,
      );
      if (this.prevZoomDist && d > 1e-4) {
        // Hands apart -> factor < 1 -> camera moves closer.
        const factor = Math.min(1.18, Math.max(0.85, this.prevZoomDist / d));
        this.callbacks.onZoom(factor);
      }
      this.prevZoomDist = d;
    }

    // A pinch is already spoken for by spin/zoom, so it never becomes an
    // action pose — otherwise dragging the orb would fire "send" repeatedly.
    const gesture: Gesture =
      mode === "idle" && primary ? classifyHand(primary) : "idle";

    this.emitStatus({ hands: landmarks.length, mode, gesture });
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands !== this.lastStatus.hands ||
      status.mode !== this.lastStatus.mode ||
      status.gesture !== this.lastStatus.gesture
    ) {
      this.lastStatus = status;
      this.callbacks.onStatus(status);
    }
  }

  private drawOverlay(landmarks: NormalizedLandmark[][]): void {
    const ctx = this.overlay?.getContext("2d");
    if (!ctx || !this.overlay) return;
    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    for (const lm of landmarks) {
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      const tx = (1 - thumb.x) * width;
      const ty = thumb.y * height;
      const ix = (1 - index.x) * width;
      const iy = index.y * height;
      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched = handScale > 1e-6 && dist2d(thumb, index) / handScale < PINCH_ON;

      ctx.strokeStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.5)";
      ctx.lineWidth = pinched ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      ctx.fillStyle = pinched ? "#ffcc66" : "rgba(255,170,48,0.7)";
      for (const [x, y] of [
        [tx, ty],
        [ix, iy],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, pinched ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
