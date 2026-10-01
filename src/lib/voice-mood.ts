// ---------------------------------------------------------------------------
// detectMood — a coarse read of how the user sounded.
//
// This exists because Hume's Expression Measurement API (which labelled
// vocal emotion across 48+ dimensions) was retired in mid-2026; the surviving
// Hume product is Octave, which *generates* expressive speech but no longer
// analyses any. So the listening side is computed here from the raw clip.
//
// The claim is deliberately modest. Speech carries prosody — pitch, loudness,
// tempo — and those correlate with arousal and stress more reliably than with
// any specific emotion. So this returns a *temperament* hint ("pressed",
// "animated", "flat"), never a diagnosis, and the prompt tells the model to
// treat it as a weak prior it may ignore.
//
// Browser-only: it needs Web Audio to decode.
// ---------------------------------------------------------------------------

import { trimSilence } from "./audio-trim";

export type Mood =
  | "stressed"
  | "animated"
  | "tired"
  | "calm";

interface MoodReading {
  mood: Mood;
  /** Median F0 in Hz; the most reliable single prosodic cue. */
  pitch: number;
  /** Coarse energy level, 0..1. */
  energy: number;
  /** Voiced frames per second — a proxy for how fast they were going. */
  rate: number;
}

const WINDOW_MS = 25;
const MIN_PITCH_HZ = 65; // below this it is probably not a voice
const MAX_PITCH_HZ = 400;

/**
 * Estimate the fundamental frequency of one window by autocorrelation.
 *
 * Crude but adequate: we only need to separate "low and strained" from "high
 * and animated", not to build a pitch tracker.
 */
function estimatePitch(samples: Float32Array, sampleRate: number): number {
  const n = samples.length;
  if (n < 256) return 0;

  // Trim the DC offset first, or autocorrelation peaks near lag 0.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;

  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), n - 1);
  if (maxLag <= minLag) return 0;

  let bestLag = -1;
  let bestScore = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i] - mean;
    energy += s * s;
  }
  if (energy / n < 1e-8) return 0; // silent window

  // One pass over every lag, keeping the full curve: the octave-error fix
  // below needs to look at lags other than the winner.
  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (samples[i] - mean) * (samples[i + lag] - mean);
    }
    const score = sum / (n - lag);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestScore <= 0) return 0;

  // Octave-error correction. The correlation also peaks at 2x and 4x the true
  // period, and a raw "highest score wins" picks those: a 240 Hz voice reads
  // as 80 Hz. So take the SHORTEST lag that is a genuine local peak and scores
  // within 85% of the global best, which is the true fundamental.
  const threshold = bestScore * 0.85;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (
      scores[lag] > threshold &&
      scores[lag] >= scores[lag - 1] &&
      scores[lag] >= scores[lag + 1]
    ) {
      return sampleRate / lag;
    }
  }
  return sampleRate / bestLag;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toMood(pitch: number, energy: number, rate: number): Mood {
  // High energy + fast + a raised voice reads as animated or wound up.
  if (energy > 0.34 && rate > 4.2 && pitch > 165) return "animated";
  // Low voice, slow, and low energy: pressed, or simply tired.
  if (pitch > 0 && pitch < 135 && rate < 3.2) return "stressed";
  if (energy < 0.12 && rate < 2.6) return "tired";
  return "calm";
}

/** Analyse a clip. Returns null when there is not enough speech to judge. */
export async function readMood(blob: Blob): Promise<MoodReading | null> {
  // Under a second there is nothing to say about how someone sounded.
  if (blob.size < 8_000) return null;

  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;

    const ctx = new Ctx();
    let buffer: AudioBuffer;
    try {
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } finally {
      void ctx.close().catch(() => {});
    }

    const rate = buffer.sampleRate;
    const frameSize = Math.max(128, Math.round((rate * WINDOW_MS) / 1000));
    const frames = Math.floor(buffer.length / frameSize);
    if (frames < 8) return null;

    // Mono, because a pitch estimate per channel would be meaningless.
    const mono = new Float32Array(buffer.length);
    const channels = buffer.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < buffer.length; i++) mono[i] += data[i];
    }
    if (channels > 1) for (let i = 0; i < buffer.length; i++) mono[i] /= channels;

    const pitches: number[] = [];
    let energySum = 0;
    let voiced = 0;

    for (let f = 0; f < frames; f++) {
      const slice = mono.subarray(f * frameSize, (f + 1) * frameSize);
      let sum = 0;
      for (let i = 0; i < slice.length; i++) sum += slice[i] * slice[i];
      const rms = Math.sqrt(sum / slice.length);
      energySum += rms;
      if (rms < 0.01) continue; // below this there is no voice to measure
      voiced++;
      const p = estimatePitch(slice, rate);
      if (p >= MIN_PITCH_HZ && p <= MAX_PITCH_HZ) pitches.push(p);
    }

    if (pitches.length < 3) return null;

    const seconds = buffer.length / rate;
    const pitch = median(pitches);
    const energy = Math.min(1, (energySum / frames) * 6);
    const ratePerSecond = voiced / Math.max(0.1, seconds);

    return { mood: toMood(pitch, energy, ratePerSecond), pitch, energy, rate: ratePerSecond };
  } catch {
    return null;
  }
}

/**
 * Decode once, then both trim and analyse.
 *
 * The two need the same decode, and doing it twice on the hot path of every
 * voice turn is a measurable cost for no benefit.
 */
export async function prepareVoiceClip(blob: Blob): Promise<{
  trimmed: Blob;
  mood: Mood | null;
}> {
  const trimmed = await trimSilence(blob);
  const reading = await readMood(trimmed);
  return { trimmed, mood: reading?.mood ?? null };
}
