// Protocol cross-check: mirror of tests/crosscheck_protocol.py using the
// TypeScript implementation. Run both and diff the output.
import { createHash } from "node:crypto";

const FRAME = { AUDIO_MIC: 0x01, AUDIO_OUT: 0x02, IMAGE: 0x03, CONTROL: 0x10 };
const IMAGE_CODEC = { JPEG: 0, WEBP: 1, PNG: 2 };
const HEADER_SIZE = 2;

const encodeControl = (message) => {
  const json = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(HEADER_SIZE + json.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, FRAME.CONTROL);
  view.setUint8(1, 0);
  frame.set(json, HEADER_SIZE);
  return frame.buffer;
};

const encodeAudio = (type, payload, final) => {
  const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, type);
  view.setUint8(1, final ? 0x01 : 0);
  frame.set(new Uint8Array(payload), HEADER_SIZE);
  return frame.buffer;
};

const encodeMic = (pcm, final = false) => encodeAudio(FRAME.AUDIO_MIC, pcm, final);
const encodeAudioOut = (pcm, final = false) => encodeAudio(FRAME.AUDIO_OUT, pcm, final);

const encodeImage = (data, codec) => {
  const frame = new Uint8Array(HEADER_SIZE + data.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint8(0, FRAME.IMAGE);
  view.setUint8(1, codec);
  frame.set(new Uint8Array(data), HEADER_SIZE);
  return frame.buffer;
};

const sha = (buf) => createHash("sha256").update(Buffer.from(buf)).digest("hex").slice(0, 16);
const enc = (s) => new TextEncoder().encode(s);

const cases = {
  mic_640: encodeMic(new Uint8Array(640).buffer),
  mic_final: encodeMic(new Uint8Array(640).buffer, true),
  audio_out_960: encodeAudioOut(new Uint8Array(960).buffer),
  audio_out_final: encodeAudioOut(new Uint8Array(960).buffer, true),
  // Raw bytes, NOT a JS string: "\xff" in a string literal is UTF-8 encoded
  // to two bytes, which would not match Python's b"\xff\xd8abc".
  image_jpeg: encodeImage(
    new Uint8Array([0xff, 0xd8, 0x61, 0x62, 0x63]).buffer,
    IMAGE_CODEC.JPEG,
  ),
  image_webp: encodeImage(enc("RIFFabc").buffer, IMAGE_CODEC.WEBP),
  control: encodeControl({ type: "CLEAR_BUFFER", reason: "barge_in" }),
};

for (const [name, data] of Object.entries(cases)) {
  const header = [...new Uint8Array(data.slice(0, 2))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  console.log(
    `${name} header=${header} len=${data.byteLength} sha256=${sha(data)}`,
  );
}
console.log("TS_PROTOCOL_OK");
