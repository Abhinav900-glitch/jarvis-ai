// ---------------------------------------------------------------------------
// trimSilence — remove the dead air around a recorded utterance.
//
// Live mode records continuously so the start of a word can never be clipped,
// which means every clip actually sent to Whisper begins with however long the
// user sat silent before speaking. That costs upload time, and it costs more
// than that: Whisper's own endpointing is measurably worse on audio with a
// long silent lead-in, and a silent clip is exactly the input that invites the
// model to hallucinate.
//
// So: decode, find where the speech actually is, keep a small pad on each
// side, and re-encode. The pad is the important part — trimming to the exact
// first sample cuts consonants, because the burst that marks a word's start is
// often quieter than the word itself.
//
// Browser-only (needs Web Audio), so it must never be imported from Convex.
// ---------------------------------------------------------------------------

/** Keep this much audio before the detected onset and after the last word. */
const PAD_MS = 120;

/** Never return a clip shorter than this, however quiet it measured. */
const MIN_KEEP_MS = 320;

/** Envelope hop. Fine enough to place a word boundary without overshooting. */
const HOP_MS = 10;

/** Noise-floor tracking, mirroring the live VAD so both agree on "quiet". */
const FLOOR_MIN = 0.004;
const FLOOR_MAX = 0.06;
const FLOOR_FALL_RATE = 0.05;
const FLOOR_RISE_RATE = 0.002;

/** Speech must clear the measured floor by this factor to count as speech. */
const SPEECH_SNR = 2.6;

/** Groq's transcription endpoint wants plain 16 kHz PCM WAV. */
const TARGET_RATE = 16000;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = 44 + samples.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

function resampleTo(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/**
 * Trim a recorded clip to the speech inside it.
 *
 * Returns the original blob untouched if anything goes wrong — a slightly long
 * clip is always better than a failed turn.
 */
export async function trimSilence(blob: Blob): Promise<Blob> {
  // Only worth doing on a clip long enough to have real dead air in it.
  if (blob.size < 12_000) return blob;

  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return blob;

    const ctx = new Ctx();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      void ctx.close().catch(() => {});
    }

    // Downmix to mono first: the envelope below is meaningless per-channel.
    const length = buffer.length;
    const mono = new Float32Array(length);
    const channels = buffer.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i];
    }
    if (channels > 1) for (let i = 0; i < length; i++) mono[i] /= channels;

    const rate = buffer.sampleRate;
    const hop = Math.max(1, Math.round((rate * HOP_MS) / 1000));
    const hopCount = Math.floor(length / hop);

    // Rolling RMS envelope + adaptive noise floor in one pass.
    const energy = new Float32Array(hopCount);
    let floor = FLOOR_MIN;
    for (let h = 0; h < hopCount; h++) {
      const start = h * hop;
      let sum = 0;
      for (let i = start; i < start + hop; i++) sum += mono[i] * mono[i];
      const rms = Math.sqrt(sum / hop);
      energy[h] = rms;
      floor = Math.min(
        FLOOR_MAX,
        Math.max(
          FLOOR_MIN,
          floor + (rms - floor) * (rms < floor ? FLOOR_FALL_RATE : FLOOR_RISE_RATE),
        ),
      );
    }

    const gate = Math.max(FLOOR_MIN, floor) * SPEECH_SNR;

    // First and last voiced hop.
    let first = -1;
    for (let h = 0; h < hopCount; h++) {
      if (energy[h] > gate) {
        first = h;
        break;
      }
    }
    if (first < 0) return blob; // genuinely silent — let Whisper decide

    // Scan to the end rather than stopping at the first long silence. The
    // live turn-end threshold is 750 ms, so a hesitant "so... um, I was
    // thinking" puts a gap longer than any small grace window in the middle of
    // a real utterance — breaking out early would cut the thought in half.
    let last = first;
    for (let h = first; h < hopCount; h++) {
      if (energy[h] > gate) last = h;
    }

    const pad = Math.round((PAD_MS / 1000) * rate);
    const minKeep = Math.round((MIN_KEEP_MS / 1000) * rate);
    let startSample = Math.max(0, first * hop - pad);
    let endSample = Math.min(length, (last + 1) * hop + pad);
    if (endSample - startSample < minKeep) {
      const centre = (startSample + endSample) / 2;
      startSample = Math.max(0, Math.floor(centre - minKeep / 2));
      endSample = Math.min(length, startSample + minKeep);
    }

    // Nothing worth sending if the trim barely changed anything.
    if (startSample === 0 && endSample >= length) return blob;

    const kept = resampleTo(mono.subarray(startSample, endSample), rate, TARGET_RATE);
    return encodeWav(kept, TARGET_RATE);
  } catch {
    // Unsupported container, decode failure, no Web Audio — ship it as-is.
    return blob;
  }
}
