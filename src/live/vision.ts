/**
 * Vision capture: webcam or screen at 1-2 fps, encoded to JPEG.
 *
 * Deliberately low frame rate. Vision frames are context for the model, not a
 * video stream — 1-2 fps keeps bandwidth at a few tens of kB/s and leaves the
 * socket almost entirely free for audio.
 *
 * Encoding happens off the render path: `toBlob` is async, and the capture
 * loop skips a tick rather than queueing if an encode is still in flight.
 */

export type VisionSource = "camera" | "screen";

export interface VisionCaptureOptions {
  source?: VisionSource;
  /** Frames per second to send. Keep at 1-2 for live conversation. */
  fps?: number;
  /** Longest edge in pixels; the server downscales further if needed. */
  maxEdge?: number;
  /** 0-1 canvas JPEG quality. */
  quality?: number;
  onFrame: (jpeg: ArrayBuffer) => void;
  onError?: (error: Error) => void;
}

export class VisionCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer: number | null = null;
  private encoding = false;
  private readonly options: Required<Omit<VisionCaptureOptions, "onError">> &
    Pick<VisionCaptureOptions, "onError">;

  constructor(options: VisionCaptureOptions) {
    this.options = {
      source: options.source ?? "camera",
      fps: options.fps ?? 1.5,
      maxEdge: options.maxEdge ?? 640,
      quality: options.quality ?? 0.6,
      onFrame: options.onFrame,
      onError: options.onError,
    };
  }

  get isActive(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    const { source, fps } = this.options;

    if (source === "screen") {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing is not supported in this browser.");
      }
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 10 } },
        audio: false,
      });
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera capture is not supported in this browser.");
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    }

    // Screen share ends when the user stops sharing from the browser UI.
    this.stream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        void this.stop();
      });
    });

    const video = document.createElement("video");
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    this.video = video;

    this.canvas = document.createElement("canvas");
    const interval = Math.max(200, Math.round(1000 / fps));
    this.timer = window.setInterval(() => {
      void this.capture();
    }, interval);
  }

  private async capture(): Promise<void> {
    const video = this.video;
    const canvas = this.canvas;
    if (!video || !canvas || this.encoding) return;
    if (video.readyState < 2 || !video.videoWidth) return;

    this.encoding = true;
    try {
      const { maxEdge } = this.options;
      const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", this.options.quality);
      });
      if (blob && blob.size > 0) {
        this.options.onFrame(await blob.arrayBuffer());
      }
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error("Vision capture failed."),
      );
    } finally {
      this.encoding = false;
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) {
      this.video.srcObject = null;
    }
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.encoding = false;
  }

  /** Snapshot of the current frame, for the local preview thumbnail. */
  getPreviewDataUrl(): string | null {
    return this.canvas && this.canvas.width > 0 ? this.canvas.toDataURL("image/jpeg", 0.4) : null;
  }
}
