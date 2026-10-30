/**
 * Active noise suppression for live mode.
 *
 * The browser's own `noiseSuppression` is a fixed filter set when the stream
 * opens: it handles steady fan whine, but it cannot follow a room that changes
 * mid-conversation, and it cannot be re-tuned once the mic exists. This is the
 * *active* half — it keeps a running estimate of the noise in each frequency
 * band, learned only from frames that look like non-speech, and subtracts it.
 * Running on the audio thread means a busy main thread cannot stall it, which
 * is the property that matters for a voice app.
 *
 * Method, per STFT frame:
 *   1. High-pass at 80 Hz and low-pass at 7.8 kHz. Almost no speech energy
 *      lives outside that band, so this costs nothing and removes a large share
 *      of rumble and hiss before it can contaminate step 3.
 *   2. Transform, and track a per-band noise magnitude. It falls fast and rises
 *      very slowly, and is only updated when the frame is not speech — the
 *      asymmetry is what stops the user's own voice being learned as noise.
 *   3. Apply a Wiener-style gain `g = snr / (1 + snr)` with `snr` from the
 *      estimated excess over the floor, so speech bands pass nearly untouched
 *      while steady bands are pulled down. No band is ever fully muted: a hard
 *      zero on a band is audible as a dropout.
 *   4. Overlap-add at 75 %.
 *
 * Bypass is a true pass-through of the input, so the toggle takes effect
 * immediately and mid-sentence, without reopening the microphone.
 */

const FRAME = 512;
const HOP = 128; // 75 % overlap
const BANDS = FRAME / 2;

const HIGH_PASS_HZ = 80;
const LOW_PASS_HZ = 7800;
const LOW_PASS_ROLLOFF_HZ = 1500;

const NOISE_FALL = 0.35; // a band that just got quieter tracks it down fast
const NOISE_RISE = 0.004; // …and creeps up only very slowly

/** Denominator floor for the speech test, so true silence is never "loud". */
const NOISE_ABS_MIN = 1e-4;

const SPEECH_BAND_FRACTION = 0.05; // ≥5 % of bands above the floor ⇒ speech
const SPEECH_BAND_RATIO = 2.5;
const SPEECH_RELEASE = 0.2; // below this, the noise estimate is trusted again
const SPEECH_ATTACK = 0.25;
/** How fast a "speech" verdict decays. Slow, because the gaps between words
 *  and the consonants inside them are both briefly quiet; releasing on those
 *  is what teaches the suppressor to eat the user's own voice. */
const SPEECH_DECAY = 0.02;

const MAX_ATTENUATION = 0.85; // deepest cut applied to any one band

/** Clamp to 0..1. A worklet cannot rely on Math.min's argument order here. */
function clamp01(value) {
  if (!Number.isFinite(value)) return 1;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Periodic Hann, used on both analysis and synthesis. */
const WINDOW = new Float32Array(FRAME);
for (let i = 0; i < FRAME; i++) {
  WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FRAME));
}

/**
 * Overlap-add normalisation.
 *
 * Hann is applied on BOTH analysis and synthesis, so a 75 %-overlap sum of
 * Hann² — not Hann — is what the running total divides by. That sum is 3/2 for
 * a periodic Hann at hop N/4, and the inverse transform already carries the
 * 1/N, so this is the only scale factor needed. Getting it wrong is a flat
 * gain error on every output sample, which sounds like a permanently
 * over-loud or over-quiet microphone.
 */
const HANN_SQUARED_OVERLAP_SUM = 1.5;

class NoiseSuppressor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.rate = opts.sampleRate || 24000;
    this.enabled = opts.enabled !== false;
    /**
     * How hard the suppressor pulls, 0..1, scaling the deepest per-band cut.
     *
     * A single fixed aggressiveness is wrong for everyone: in a quiet room 0.85
     * costs clarity for nothing, and next to a road the same setting leaves too
     * much. The slider in the live tuning panel posts a new value straight to
     * this thread, so it takes effect mid-sentence.
     */
    this.strength = typeof opts.strength === "number" ? clamp01(opts.strength) : 1;

    // Input assembly. Sized generously: at 48 kHz a 128-sample quantum is
    // ~2.7 ms, so the pending buffer never approaches FRAME * 4 between frames.
    this.pending = new Float32Array(FRAME * 8);
    this.pendingLen = 0;

    // Overlap-add accumulator and its write cursor.
    this.ola = new Float32Array(FRAME);
    this.olaLen = 0;

    // High-pass filter state, persistent across frames — a filter restarted per
    // frame would inject a step discontinuity on every boundary.
    this.hpIn = 0;
    this.hpOut = 0;
    this.hpCoef = Math.exp((-2 * Math.PI * HIGH_PASS_HZ) / this.rate);

    // Scratch, allocated once.
    this.frame = new Float32Array(FRAME);
    this.re = new Float32Array(FRAME);
    this.im = new Float32Array(FRAME);
    this.mag = new Float32Array(BANDS);

    /** Per-band noise magnitude estimate. */
    this.noise = new Float32Array(BANDS);
    this.primed = false;
    /** 0 = confidently background, 1 = confidently speech. */
    this.speechEnergy = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;
      if (typeof data.strength === "number") {
        this.strength = clamp01(data.strength);
        return;
      }
      if (typeof data.enabled !== "boolean") return;
      this.enabled = data.enabled;
      if (!this.enabled) {
        // Forget the room. A stale estimate applied to a changed environment is
        // worse than no estimate, so a re-enable re-learns from scratch.
        this.primed = false;
        this.noise.fill(0);
        this.speechEnergy = 0;
      }
    };
  }

  binHz(k) {
    return (k * this.rate) / FRAME;
  }

  /** Suppress one complete frame, appending FRAME samples to the OLA buffer. */
  processFrame() {
    const { frame, re, im, mag, noise } = this;

    frame.set(this.pending.subarray(0, FRAME));

    // 1. High-pass — into `frame`, which is our own copy, never the ring.
    for (let i = 0; i < FRAME; i++) {
      const x = frame[i];
      const y = this.hpCoef * (this.hpOut + x - this.hpIn);
      this.hpIn = x;
      this.hpOut = y;
      frame[i] = y;
    }

    // 2. Analysis.
    for (let i = 0; i < FRAME; i++) {
      re[i] = frame[i] * WINDOW[i];
      im[i] = 0;
    }
    fft(re, im);

    for (let k = 0; k < BANDS; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
    }

    // Learn the room, but only from a frame we believe is background.
    //
    // The very first frame has to seed the estimate outright rather than be
    // classified: with the estimate still all zeros every band looks
    // infinitely louder than its floor, so the detector would call that frame
    // speech, and having called it speech it would refuse to learn from
    // anything afterwards. The suppressor would then sit silent forever.
    if (!this.primed) {
      noise.set(mag);
      this.primed = true;
    } else {
      let loudBands = 0;
      for (let k = 1; k < BANDS; k++) {
        if (mag[k] / Math.max(noise[k], NOISE_ABS_MIN) > SPEECH_BAND_RATIO) {
          loudBands++;
        }
      }
      const fraction = loudBands / (BANDS - 1);
      this.speechEnergy =
        fraction > SPEECH_BAND_FRACTION
          ? Math.min(1, this.speechEnergy + SPEECH_ATTACK)
          : Math.max(0, this.speechEnergy - SPEECH_DECAY);

      if (this.speechEnergy < SPEECH_RELEASE) {
        for (let k = 1; k < BANDS; k++) {
          const n = noise[k];
          const m = mag[k];
          noise[k] = m < n ? n + (m - n) * NOISE_FALL : n + (m - n) * NOISE_RISE;
        }
      }
    }

    // 4. Suppress.
    for (let k = 1; k < BANDS; k++) {
      const hz = this.binHz(k);
      let g;
      if (hz > LOW_PASS_HZ) {
        const rolloff = (hz - LOW_PASS_HZ) / LOW_PASS_ROLLOFF_HZ;
        g = Math.max(0, 1 - rolloff);
      } else {
        const n = noise[k];
        const excess = Math.max(0, mag[k] - n);
        const snr = Math.min(6, excess / Math.max(n, NOISE_ABS_MIN));
        const wiener = snr / (1 + snr);
        g = 1 - MAX_ATTENUATION * this.strength * (1 - wiener);
      }
      re[k] *= g;
      im[k] *= g;
      const mirror = FRAME - k;
      re[mirror] *= g;
      im[mirror] *= g;
    }
    re[0] = 0;
    im[0] = 0;
    re[BANDS] = 0;
    im[BANDS] = 0;

    // Inverse transform, by handing the forward routine its two arrays swapped.
    //
    // The array ordering here is easy to get backwards, so to state it once:
    // for `fft(A, B)` this implementation produces
    //     A'[k] = sum A[n]cos(kn) - B[n]sin(kn)
    //     B'[k] = sum B[n]cos(kn) + A[n]sin(kn)
    // Feeding it (I_f, R_f) — i.e. swapped — puts N*x in B'[k], and B is the
    // `re` array. So the time-domain signal is in `re` and `im` collapses to
    // zero. Reading `im` here yields pure silence.
    fft(im, re);

    const scale = 1 / FRAME / HANN_SQUARED_OVERLAP_SUM;
    for (let i = 0; i < FRAME; i++) {
      this.ola[i] += re[i] * scale * WINDOW[i];
    }
    this.olaLen = FRAME;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const inCh = input && input[0];
    if (!inCh || inCh.length === 0) {
      for (const ch of output) ch.fill(0);
      return true;
    }

    // Bypass: hard pass-through, so toggling is instant and click-free.
    if (!this.enabled) {
      for (let c = 0; c < output.length; c++) {
        output[c].set(input[c] ?? inCh);
      }
      return true;
    }

    // Standard render quanta are 128 samples, which is exactly our hop. A
    // shorter quantum would desynchronise the overlap, so wait rather than emit
    // a wrong-sized block.
    if (inCh.length < HOP) {
      for (const ch of output) ch.fill(0);
      return true;
    }

    // Analyse channel 0 and copy the result to every output channel. A
    // microphone is mono in practice, and keeping one set of frame-assembly
    // state per channel would be complexity for a case that does not occur —
    // whereas getting that state wrong is what breaks the suppressor outright.
    //
    // NOTE: this state deliberately persists across `process()` calls. The
    // assembly buffer is a frame longer than a quantum, so resetting it per
    // call would discard every partial frame and silently emit pure silence.
    const outCh = output[0];
    outCh.fill(0);
    const extra = Array.from(output).slice(1);

    for (let i = 0; i < inCh.length; i++) {
      this.pending[this.pendingLen++] = inCh[i];

      if (this.pendingLen === FRAME) {
        this.processFrame();

        // Emit the leading HOP samples of the overlap-add result.
        for (let j = 0; j < HOP; j++) outCh[j] = this.ola[j];
        this.ola.copyWithin(0, HOP, FRAME);
        this.ola.fill(0, FRAME - HOP);

        // Advance the input by one hop and carry the overlap into the next
        // frame — this is what makes it overlap-add rather than a hard chop.
        this.pending.copyWithin(0, HOP, FRAME);
        this.pendingLen = FRAME - HOP;
      }
    }

    for (const ch of extra) ch.set(outCh);

    return true;
  }
}

/**
 * In-place radix-2 FFT.
 *
 * Inlined and dependency-free because an AudioWorklet has no module graph: it
 * runs in its own global scope where `import` is unavailable. Twiddle factors
 * are recomputed per call, which at a 128-sample hop is a rounding error next
 * to the copy cost and keeps the state down to three arrays.
 */
function fft(re, im) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) return;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

registerProcessor("noise-suppressor", NoiseSuppressor);