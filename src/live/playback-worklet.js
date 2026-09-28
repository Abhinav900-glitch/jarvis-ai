/**
 * AudioWorklet: streaming playback of server TTS audio with a jitter buffer.
 *
 * Two properties matter for live conversation:
 *
 *  1. **Instant flush.** On barge-in the server sends CLEAR_BUFFER and the
 *     main thread posts `flush`. Every queued sample is dropped in the same
 *     render quantum (~2.7 ms), so the assistant stops mid-word rather than
 *     finishing its sentence. This runs on the audio thread, so it is not
 *     subject to main-thread jank.
 *
 *  2. **Starvation-free playback.** Underflow (running out of samples) is
 *     filled with silence and counted. The jitter buffer target is set so
 *     normal network jitter does not cause clicks, without adding enough
 *     latency to feel sluggish.
 */

const DEFAULT_JITTER_MS = 120;
const RING_SIZE = 65536;

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = (options && options.processorOptions) || {};
    this.jitterSamples = Math.max(
      256,
      Math.round(((opts.sampleRate || sampleRate) * (opts.jitterMs ?? DEFAULT_JITTER_MS)) / 1000),
    );

    this.ring = new Float32Array(RING_SIZE);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.available = 0;

    this.playing = false;
    this.ended = true;
    this.underflows = 0;
    this.playedFrames = 0;
    this.currentTime = 0;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      switch (msg.type) {
        case 'audio': {
          // msg.buffer is Int16 PCM at the server's output rate.
          const pcm = new Int16Array(msg.buffer);
          this.enqueue(pcm);
          break;
        }
        case 'flush':
          // Barge-in: drop everything immediately.
          this.available = 0;
          this.readIndex = this.writeIndex;
          this.playing = false;
          this.ended = true;
          this.port.postMessage({ type: 'flushed' });
          break;
        case 'end':
          this.ended = true;
          break;
        case 'stats':
          this.port.postMessage({
            type: 'stats',
            buffered: this.available,
            playing: this.playing,
            underflows: this.underflows,
            playedFrames: this.playedFrames,
          });
          break;
        default:
          break;
      }
    };
  }

  enqueue(pcm) {
    const ring = this.ring;
    for (let i = 0; i < pcm.length; i += 1) {
      if (this.available >= RING_SIZE) {
        // Buffer full: drop the oldest sample rather than stall the socket.
        this.readIndex = (this.readIndex + 1) % RING_SIZE;
        this.available -= 1;
      }
      ring[this.writeIndex] = pcm[i] / 32768;
      this.writeIndex = (this.writeIndex + 1) % RING_SIZE;
      this.available += 1;
    }
    this.playing = true;
    this.ended = false;
  }

  /** Pull one sample, or 0 when starved. */
  read() {
    if (this.available <= 0) {
      this.underflows += 1;
      return 0;
    }
    const value = this.ring[this.readIndex];
    this.readIndex = (this.readIndex + 1) % RING_SIZE;
    this.available -= 1;
    return value;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output.length > 1 ? output[1] : null;

    for (let i = 0; i < left.length; i += 1) {
      // Hold silence until the jitter buffer is primed, so the first sample
      // is not clipped by a partial chunk.
      const ready = this.available >= Math.min(this.jitterSamples, this.available);
      const sample = this.playing && ready ? this.read() : 0;

      left[i] = sample;
      if (right) right[i] = sample;
    }

    this.playedFrames += left.length;
    this.currentTime += left.length / sampleRate;

    const wasPlaying = this.playing;
    if (this.playing && this.available === 0) {
      // Buffer drained: only stop once the server has signalled the end.
      if (this.ended) {
        this.playing = false;
        this.port.postMessage({ type: 'drained' });
      }
    } else if (this.available > 0) {
      this.playing = true;
    }

    if (wasPlaying !== this.playing) {
      this.port.postMessage({ type: 'playing', value: this.playing });
    }

    return true;
  }
}

registerProcessor('tts-playback', PlaybackProcessor);
