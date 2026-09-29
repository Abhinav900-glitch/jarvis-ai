import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Detect the audio format of raw TTS bytes by magic number.
 *
 * The `speak` action returns a bare ArrayBuffer, but the format depends on
 * which provider answered: Groq Orpheus sends WAV, ElevenLabs sends MP3.
 * Handing an MP3 to a Blob typed `audio/wav` makes some browsers (notably
 * Safari/iOS) refuse to play it, so the type is sniffed instead of assumed.
 */
export function audioMimeType(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer.slice(0, 16));
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...Array.from(view.slice(start, end)));

  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(4, 8) === "ftyp") return "audio/mp4";
  // MP3: an "ID3" tag, or a frame sync word (11 bits set) in the first bytes.
  if (ascii(0, 3) === "ID3") return "audio/mpeg";
  if (view.length >= 2 && view[0] === 0xff && (view[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  if (view[0] === 0x1a && view[1] === 0x45 && view[2] === 0xdf) {
    return "audio/webm";
  }
  return "audio/mpeg";
}
