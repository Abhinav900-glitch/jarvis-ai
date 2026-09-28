/**
 * Microphone capture: getUserMedia -> AudioWorklet -> 20 ms Int16 frames.
 *
 * The worklet does the downmix, resample to 16 kHz, and framing on the audio
 * thread. This class only wires it up and forwards frames to a callback.
 */

import { MIC_FRAME_MS, MIC_SAMPLE_RATE } from "./protocol";

export interface MicCaptureOptions {
  /** Called with one 20 ms Int16 PCM frame (640 bytes). */
  onFrame: (pcm: Int16Array) => void;
  /** 0..1 mic level for UI meters. */
  onLevel?: (level: number) => void;
  /** True when local VAD thinks the user is speaking. */
  onSpeech?: (speaking: boolean) => void;
  onError?: (error: Error) => void;
}

export class MicCapture {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private readonly options: MicCaptureOptions;
  private stopped = false;

  constructor(options: MicCaptureOptions) {
    this.options = options;
  }

  get isActive(): boolean {
    return this.context !== null && !this.stopped;
  }

  async start(): Promise<void> {
    if (this.context) return;
    this.stopped = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported in this browser.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // The worklet resamples to 16 kHz, so the context can stay at the hardware
    // rate (usually 48 kHz) for the best capture quality.
    this.context = new AudioContextCtor({ latencyHint: "interactive" });
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    await this.context.audioWorklet.addModule(
      new URL("./mic-worklet.js", import.meta.url),
    );

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "mic-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: {
        targetSampleRate: MIC_SAMPLE_RATE,
        frameSamples: (MIC_SAMPLE_RATE * MIC_FRAME_MS) / 1000,
      },
    });

    this.node.port.onmessage = (event: MessageEvent) => {
      if (this.stopped) return;
      const msg = event.data as {
        type: string;
        buffer?: ArrayBuffer;
        value?: number;
      };
      switch (msg.type) {
        case "audio":
          if (msg.buffer) this.options.onFrame(new Int16Array(msg.buffer));
          break;
        case "level":
          this.options.onLevel?.(msg.value ?? 0);
          break;
        case "speaking":
          this.options.onSpeech?.(Boolean(msg.value));
          break;
        default:
          break;
      }
    };

    this.node.onprocessorerror = () => {
      this.options.onError?.(new Error("Microphone audio worklet failed."));
    };

    this.source.connect(this.node);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      this.node?.port.postMessage({ type: "flush" });
      this.node?.disconnect();
      this.source?.disconnect();
    } catch {
      /* already torn down */
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed") {
      await this.context.close().catch(() => {});
    }
    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}
