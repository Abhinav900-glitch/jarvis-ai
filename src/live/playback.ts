/**
 * TTS playback: server PCM -> AudioWorklet -> speakers.
 *
 * The AudioContext is created at the server's output sample rate so no
 * resampling happens on the main thread. `flush()` is what makes barge-in feel
 * instant — it drops every queued sample on the audio thread within a single
 * render quantum.
 */

export interface PlaybackOptions {
  /** Server TTS output rate, e.g. 24000. */
  sampleRate?: number;
  /** Jitter buffer target in ms. */
  jitterMs?: number;
  onPlayingChange?: (playing: boolean) => void;
  onDrained?: () => void;
}

export class TtsPlayback {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private readonly options: PlaybackOptions;
  private draining = false;

  constructor(options: PlaybackOptions = {}) {
    this.options = options;
  }

  get isActive(): boolean {
    return this.context !== null;
  }

  async start(): Promise<void> {
    if (this.context) return;

    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    // Match the server rate exactly; browsers resample AudioContext output
    // internally, so this avoids a resampling stage in our own graph.
    this.context = new AudioContextCtor({
      sampleRate: this.options.sampleRate ?? 24000,
      latencyHint: "interactive",
    });
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    await this.context.audioWorklet.addModule(
      new URL("./playback-worklet.js", import.meta.url),
    );

    this.node = new AudioWorkletNode(this.context, "tts-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        sampleRate: this.context.sampleRate,
        jitterMs: this.options.jitterMs ?? 120,
      },
    });

    this.node.port.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type: string; value?: boolean };
      if (msg.type === "playing") {
        this.options.onPlayingChange?.(Boolean(msg.value));
      } else if (msg.type === "drained") {
        this.draining = false;
        this.options.onPlayingChange?.(false);
        this.options.onDrained?.();
      }
    };

    this.node.connect(this.context.destination);
  }

  /** Enqueue one Int16 PCM chunk from the server. */
  enqueue(pcm: ArrayBuffer): void {
    if (!this.node) return;
    // Copy: the socket's buffer is reused by the browser, and the worklet
    // takes ownership of what it receives.
    const copy = pcm.slice(0);
    this.node.port.postMessage({ type: "audio", buffer: copy }, [copy]);
  }

  /** Signal that no more audio is coming for this utterance. */
  markEnd(): void {
    this.draining = true;
    this.node?.port.postMessage({ type: "end" });
  }

  /**
   * Drop everything buffered immediately.
   *
   * Called on CLEAR_BUFFER (barge-in) and when the user interrupts. This is
   * the single most important call for live feel.
   */
  flush(): void {
    this.draining = false;
    this.node?.port.postMessage({ type: "flush" });
    this.options.onPlayingChange?.(false);
  }

  async stop(): Promise<void> {
    this.flush();
    try {
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    if (this.context && this.context.state !== "closed") {
      await this.context.close().catch(() => {});
    }
    this.node = null;
    this.context = null;
  }
}
