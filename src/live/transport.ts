/**
 * WebSocket transport for the live session.
 *
 * Responsibilities:
 *  * connect to the local pipeline with backoff and reconnect
 *  * send binary frames (audio/image) and JSON control messages
 *  * dispatch inbound audio and control messages to handlers
 *
 * Audio is sent immediately and never queued behind a slow socket: if the
 * socket buffer backs up, dropping stale audio is better than adding latency.
 */

import {
  decodeControl,
  decodeFrame,
  encodeControl,
  encodeImage,
  encodeMic,
  FRAME,
  IMAGE_CODEC,
  MIC_SAMPLE_RATE,
  OUT_SAMPLE_RATE,
  type ImageCodecValue,
  type ServerControlMessage,
  type SessionState,
} from "./protocol";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed" | "error";

export interface TransportCallbacks {
  onStatus?: (status: ConnectionStatus, detail?: string) => void;
  onAudio?: (pcm: ArrayBuffer, isFinal: boolean) => void;
  onControl?: (message: ServerControlMessage) => void;
  /** Fired when the server's negotiated output rate arrives. */
  onReady?: (outSampleRate: number) => void;
}

const DEFAULT_URL = "ws://127.0.0.1:8787/ws/live";
const MAX_BACKOFF_MS = 8000;

export class LiveTransport {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly callbacks: TransportCallbacks;
  private status: ConnectionStatus = "idle";
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private audioFramesSent = 0;
  private imageFramesSent = 0;
  /**
   * System instructions sent with the next `session.start`.
   *
   * Settable rather than constructor-only because the transport is created once
   * per connection while the instructions come from React options that may
   * change between renders; reading them at send time keeps the two in step
   * without rebuilding the socket.
   */
  private instructions: string | null = null;

  constructor(url: string = DEFAULT_URL, callbacks: TransportCallbacks = {}) {
    this.url = url;
    this.callbacks = callbacks;
  }

  /** Instructions for the local model, applied on the next session start. */
  setInstructions(value: string | null): void {
    this.instructions = value && value.trim() ? value : null;
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get stats(): { audioFrames: number; imageFrames: number } {
    return { audioFrames: this.audioFramesSent, imageFrames: this.imageFramesSent };
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.manuallyClosed = false;
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.setStatus("error", error instanceof Error ? error.message : "Could not open socket");
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      this.sendControl({
        type: "session.start",
        sampleRate: MIC_SAMPLE_RATE,
        visionContext: 1,
        // Omitted entirely when unset, so a server written before this field
        // existed receives exactly the payload it always did.
        ...(this.instructions ? { instructions: this.instructions } : {}),
      });
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        const message = decodeControl(new TextEncoder().encode(event.data).buffer as ArrayBuffer);
        if (message) this.dispatchControl(message);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        this.dispatchFrame(event.data);
      }
    };

    socket.onerror = () => {
      // `onclose` always follows, so reconnect logic lives there.
      this.setStatus("error", "WebSocket error");
    };

    socket.onclose = (event: CloseEvent) => {
      this.socket = null;
      if (this.manuallyClosed) {
        this.setStatus("closed");
        return;
      }
      this.setStatus("reconnecting", event.reason || undefined);
      this.scheduleReconnect();
    };
  }

  private dispatchFrame(data: ArrayBuffer): void {
    const frame = decodeFrame(data);
    if (!frame) return;
    if (frame.type === FRAME.AUDIO_OUT) {
      this.callbacks.onAudio?.(frame.payload, frame.isFinal);
      return;
    }
    if (frame.type === FRAME.CONTROL) {
      const message = decodeControl(frame.payload);
      if (message) this.dispatchControl(message);
    }
  }

  private dispatchControl(message: ServerControlMessage): void {
    if (message.type === "session.ready") {
      const rate = Number(message.outSampleRate ?? OUT_SAMPLE_RATE);
      this.callbacks.onReady?.(Number.isFinite(rate) ? rate : OUT_SAMPLE_RATE);
    }
    this.callbacks.onControl?.(message);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(MAX_BACKOFF_MS, 300 * 2 ** (this.reconnectAttempts - 1));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private setStatus(status: ConnectionStatus, detail?: string): void {
    this.status = status;
    this.callbacks.onStatus?.(status, detail);
  }

  // ------------------------------------------------------------------ //
  // Sending
  // ------------------------------------------------------------------ //

  sendControl(message: Record<string, unknown>): boolean {
    if (!this.isOpen) return false;
    try {
      this.socket!.send(encodeControl(message));
      return true;
    } catch {
      return false;
    }
  }

  sendAudio(pcm: Int16Array): boolean {
    if (!this.isOpen) return false;
    try {
      // A backed-up socket means stale audio; drop rather than queue.
      if (this.socket!.bufferedAmount > 512 * 1024) return false;
      this.socket!.send(encodeMic(pcmToArrayBuffer(pcm)));
      this.audioFramesSent += 1;
      return true;
    } catch {
      return false;
    }
  }

  sendImage(jpeg: ArrayBuffer, codec: ImageCodecValue = IMAGE_CODEC.JPEG): boolean {
    if (!this.isOpen) return false;
    try {
      if (this.socket!.bufferedAmount > 1024 * 1024) return false;
      this.socket!.send(encodeImage(jpeg, codec));
      this.imageFramesSent += 1;
      return true;
    } catch {
      return false;
    }
  }

  sendText(text: string): boolean {
    return this.sendControl({ type: "text", text });
  }

  interrupt(): boolean {
    return this.sendControl({ type: "interrupt" });
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sendControl({ type: "session.stop" });
    this.socket?.close();
    this.socket = null;
    this.setStatus("closed");
  }
}

function pcmToArrayBuffer(pcm: Int16Array): ArrayBuffer {
  return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
}

export type { SessionState };
