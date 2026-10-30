/**
 * AudioWorklet: microphone capture, downmix, resample to 16 kHz mono, and
 * 20 ms Int16 framing.
 *
 * Runs on the audio render thread so capture is never affected by main-thread
 * jank (React re-renders, websocket sends, GC pauses). The main thread only
 * receives finished 640-byte frames ready to put straight on the wire.
 *
 * Resampling uses a box-filter pre-average before linear interpolation: a
 * naive decimation of 48 kHz -> 16 kHz aliases badly, and the aliased energy
 * both degrades Whisper accuracy and trips the server-side VAD.
 */

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms @ 16 kHz
const RING_SIZE = 32768;

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || TARGET_SAMPLE_RATE;
    this.frameSamples = opts.frameSamples || FRAME_SAMPLES;

    this.sourceRate = sampleRate;
    this.ratio = this.sourceRate / this.targetRate;

    // Ring buffer holding downsampled float samples awaiting framing.
    this.ring = new Float32Array(RING_SIZE);
    this.ringWrite = 0;
    this.ringAvailable = 0;

    // Fractional read position for the resampler.
    this.position = 0;
    this.primed = false;
    this.lastSample = 0;

    // Anti-alias pre-average state.
    this.accSum = 0;
    this.accCount = 0;
    this.decimation = Math.max(1, Math.round(this.ratio));

    // Level metering for the UI waveform.
    this.level = 0;
    this.speaking = false;
    this.silenceRun = 0;
    this.voiceRun = 0;

    // Counters for diagnostics.
    this.framesSent = 0;
    this.dropped = 0;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'flush') {
        this.ringAvailable = 0;
        this.ringWrite = 0;
        this.position = 0;
        this.accSum = 0;
        this.accCount = 0;
      } else if (msg.type === 'stats') {
        this.port.postMessage({
          type: 'stats',
          framesSent: this.framesSent,
          dropped: this.dropped,
          level: this.level,
        });
      }
    };
  }

  /** Push one downsampled sample into the ring, emitting whole frames. */
  pushSample(value) {
    const ring = this.ring;
    ring[this.ringWrite] = value;
    this.ringWrite = (this.ringWrite + 1) % RING_SIZE;
    this.ringAvailable += 1;

    if (this.ringAvailable >= this.frameSamples) {
      const out = new Int16Array(this.frameSamples);
      let write = this.ringWrite;
      for (let i = 0; i < this.frameSamples; i += 1) {
        write = (write - 1 + RING_SIZE) % RING_SIZE;
        const s = ring[write];
        const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
        out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.ringAvailable -= this.frameSamples;
      this.framesSent += 1;
      // Transfer rather than copy: this is the hot path.
      this.port.postMessage({ type: 'audio', buffer: out.buffer }, [out.buffer]);
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channels = input.length;
    const blockSize = input[0] ? input[0].length : 0;
    if (blockSize === 0) return true;

    let sumSquares = 0;

    for (let i = 0; i < blockSize; i += 1) {
      // Downmix to mono.
      let mono = 0;
      for (let c = 0; c < channels; c += 1) {
        const data = input[c];
        mono += data ? data[i] : 0;
      }
      mono /= channels;
      sumSquares += mono * mono;

      // Pre-average (box filter) to attenuate above-Nyquist content before
      // decimation, then linearly interpolate onto the target rate.
      this.accSum += mono;
      this.accCount += 1;
      if (this.accCount >= this.decimation) {
        const averaged = this.accSum / this.accCount;
        this.accSum = 0;
        this.accCount = 0;
        this.emitResampled(averaged);
      }
    }

    // RMS level with a fast attack / slow release envelope.
    const rms = Math.sqrt(sumSquares / blockSize);
    const target = Math.min(1, rms * 6);
    this.level = target > this.level ? target : this.level * 0.85 + target * 0.15;

    // Local speech gate so the UI can show "hearing you" without a round trip.
    if (rms > 0.02) {
      this.voiceRun += 1;
      this.silenceRun = 0;
    } else {
      this.silenceRun += 1;
      this.voiceRun = 0;
    }
    const nowSpeaking = this.voiceRun > 3;
    if (nowSpeaking !== this.speaking) {
      this.speaking = nowSpeaking;
      this.port.postMessage({ type: 'speaking', value: nowSpeaking });
    }

    // Level telemetry at ~20 Hz.
    const now = currentTime;
    if (!this.lastLevelPost || now - this.lastLevelPost > 0.05) {
      this.lastLevelPost = now;
      this.port.postMessage({ type: 'level', value: this.level, rms: rms });
    }

    return true;
  }

  /** Linear-interpolation resampler fed with pre-averaged samples. */
  emitResampled(averaged) {
    if (!this.primed) {
      this.primed = true;
      this.lastSample = averaged;
      this.position = 0;
      this.pushSample(averaged);
      return;
    }

    const step = 1 / this.ratio;
    while (this.position < 1) {
      const value = this.lastSample + (averaged - this.lastSample) * this.position;
      this.pushSample(value);
      this.position += step;
    }
    this.position -= 1;
    this.lastSample = averaged;
  }
}

registerProcessor('mic-capture', MicCaptureProcessor);
