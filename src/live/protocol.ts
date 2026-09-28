/**
 * TypeScript mirror of `live-server/app/protocol.py`.
 *
 * The two files are a single contract: if you change a frame type, a flag bit,
 * a sample rate, or a control message name here, change it there too.
 *
 * Frame layout (little-endian):
 *
 *   +--------+--------+------------------+
 *   | 1 byte | 1 byte | N bytes          |
 *   | type   | flags  | payload          |
 *   +--------+--------+------------------+
 */

export const FRAME = {
  /** client -> server: Int16LE mono PCM @16 kHz */
  AUDIO_MIC: 0x01,
  /** server -> client: Int16LE mono PCM @ the TTS output rate */
  AUDIO_OUT: 0x02,
  /** client -> server: encoded image */
  IMAGE: 0x03,
  /** either direction: UTF-8 JSON */
  CONTROL: 0x10,
} as const;

export type FrameType = (typeof FRAME)[keyof typeof FRAME];

export const IMAGE_CODEC = {
  JPEG: 0,
  WEBP: 1,
  PNG: 2,
} as const;

export type ImageCodecValue = (typeof IMAGE_CODEC)[keyof typeof IMAGE_CODEC];

/** `flags` bit marking the final audio chunk of an utterance. */
export const AUDIO_FLAG_FINAL = 0x01;

export const HEADER_SIZE = 2;

export const MIC_SAMPLE_RATE = 16000;
export const MIC_FRAME_MS = 20;
export const MIC_FRAME_SAMPLES = 320;
export const MIC_FRAME_BYTES = MIC_FRAME_SAMPLES * 2;

export const OUT_SAMPLE_RATE = 24000;
export const OUT_FRAME_SAMPLES = 480;
export const OUT_FRAME_BYTES = OUT_FRAME_SAMPLES * 2;

// --------------------------------------------------------------------------
// Control message vocabulary
// --------------------------------------------------------------------------

export const CTRL = {
  // client -> server
  SESSION_START: "session.start",
  SESSION_STOP: "session.stop",
  TEXT: "text",
  INTERRUPT: "interrupt",
  AUDIO_END: "audio.end",

  // server -> client
  SESSION_READY: "session.ready",
  STATE: "state",
  TRANSCRIPT_PARTIAL: "transcript.partial",
  TRANSCRIPT_FINAL: "transcript.final",
  RESPONSE_DELTA: "response.delta",
  RESPONSE_DONE: "response.done",
  CLEAR_BUFFER: "CLEAR_BUFFER",
  ERROR: "error",
} as const;

export type SessionState = "idle" | "listening" | "thinking" | "speaking";

export interface SessionStartMessage {
  type: typeof CTRL.SESSION_START;
  sampleRate?: number;
  language?: string | null;
  voice?: string | null;
  visionContext?: number;
}

export interface TextMessage {
  type: typeof CTRL.TEXT;
  text: string;
}

export interface ServerControlMessage {
  type: string;
  [key: string]: unknown;
}

// --------------------------------------------------------------------------
// Encoding
// --------------------------------------------------------------------------

export function encodeControl(message: Record<string, unknown>): ArrayBuffer {
  const json = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(HEADER_SIZE + json.byteLength);
  new DataView(frame.buffer).setUint8(0, FRAME.CONTROL);
  new DataView(frame.buffer).setUint8(1, 0);
  frame.set(json, HEADER_SIZE);
  return frame.buffer;
}

export function encodeMic(pcm: ArrayBuffer, final = false): ArrayBuffer {
  return encodeAudio(FRAME.AUDIO_MIC, pcm, final);
}

export function encodeAudioOut(pcm: ArrayBuffer, final = false): ArrayBuffer {
  return encodeAudio(FRAME.AUDIO_OUT, pcm, final);
}

function encodeAudio(type: number, payload: ArrayBuffer, final: boolean): ArrayBuffer {
  const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, type);
  view.setUint8(1, final ? AUDIO_FLAG_FINAL : 0);
  frame.set(new Uint8Array(payload), HEADER_SIZE);
  return frame.buffer;
}

export function encodeImage(data: ArrayBuffer, codec: ImageCodecValue): ArrayBuffer {
  const frame = new Uint8Array(HEADER_SIZE + data.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, FRAME.IMAGE);
  view.setUint8(1, codec);
  frame.set(new Uint8Array(data), HEADER_SIZE);
  return frame.buffer;
}

// --------------------------------------------------------------------------
// Decoding
// --------------------------------------------------------------------------

export interface DecodedFrame {
  type: number;
  flags: number;
  payload: ArrayBuffer;
  isFinal: boolean;
}

export function decodeFrame(data: ArrayBuffer): DecodedFrame | null {
  if (data.byteLength < HEADER_SIZE) return null;
  const view = new DataView(data);
  const type = view.getUint8(0);
  const flags = view.getUint8(1);
  return {
    type,
    flags,
    payload: data.slice(HEADER_SIZE),
    isFinal: (flags & AUDIO_FLAG_FINAL) !== 0,
  };
}

export function decodeControl(payload: ArrayBuffer): ServerControlMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload));
    return typeof parsed === "object" && parsed !== null ? (parsed as ServerControlMessage) : null;
  } catch {
    return null;
  }
}

/** Int16 PCM -> Uint8Array view over the same bytes, for transfer to the worklet. */
export function pcmToTransfer(pcm: Int16Array): ArrayBuffer {
  return pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
}
