# Freebuff — Local Live Voice + Vision Pipeline

A native, low-latency voice and vision mode built entirely from local,
open-source models. **No third-party multimodal API is involved** — STT, LLM,
TTS and VAD all run on your own machine.

```
┌─ Browser ─────────────────────────────────────────────┐
│  Mic ──► AudioWorklet ──► 16 kHz mono Int16 PCM        │
│         (20 ms frames, resampled on audio thread)     │
│                        │                              │
│  Camera ──► canvas ──► JPEG @ 1-2 fps                 │
│                        │                              │
│  WebSocket (binary) ───┴──────────────┐                │
│                                       ▼                │
│  TTS PCM ──► PlaybackWorklet ──► speakers              │
│         (jitter buffer, instant flush on barge-in)    │
└───────────────────────────────────────────────────────┘
                          │  ws://127.0.0.1:8787/ws/live
                          ▼
┌─ FastAPI ─────────────────────────────────────────────┐
│  WebSocket ingest                                     │
│    ├── audio queue ──► Silero-VAD ──► SpeechSegmenter│
│    │                      │                           │
│    │                 endpoint / barge-in              │
│    │                      ▼                           │
│    │              StreamingTranscriber                │
│    │              (faster-whisper: partial + final)   │
│    │                      ▼                           │
│    │                  LLM router ──► token stream     │
│    │                      ▼                           │
│    │              TextSegmenter (sentence chunks)     │
│    │                      ▼                           │
│    │              Piper / Kokoro TTS ──► PCM stream   │
│    │                                                  │
│    └── vision queue ──► VisionBuffer (drop-oldest)    │
└───────────────────────────────────────────────────────┘
                          │
                          ▼  OpenAI-compatible /v1 (localhost only)
              llama.cpp · Ollama · vLLM · LM Studio
```

---

## Why the pieces are shaped this way

**Capture happens on the audio thread.** `mic-worklet.js` does the downmix,
resampling and framing inside an `AudioWorkletProcessor`, so a React re-render
or a GC pause can never drop a frame. The main thread only receives finished
640-byte frames ready for the socket. A box-filter pre-average runs before
decimation because naive 48 kHz → 16 kHz sampling aliases badly — the aliased
energy degrades Whisper *and* trips the VAD.

**Streaming STT is two passes.** faster-whisper is a batch model, not a
token-streaming one, so `StreamingTranscriber` emits a cheap **partial**
transcript while you are still talking (for live captions) and one full-quality
**final** transcript at the endpoint. Partials never enter conversation
history.

**Speaking token-by-token sounds robotic.** `TextSegmenter` buffers LLM tokens
and flushes at clause boundaries, so each TTS call gets a natural sentence and
audio for sentence N+1 is synthesised while sentence N is still on the wire.

**Vision is a drop-oldest ring.** Camera frames go 1-2 fps into a bounded
buffer. A 2-second-old screenshot is worse than useless, and back-pressuring
the socket would add latency to the audio stream — so stale frames are dropped,
never queued.

**Interruption is the delicate part.** See below.

---

## Interruption (the part that decides whether this feels alive)

When you talk over the assistant, the server must, in order:

| # | Action | Why this order |
|---|--------|----------------|
| a | Send `CLEAR_BUFFER` control frame | You hear silence *immediately*. The client drops every queued sample inside one render quantum (~2.7 ms). |
| b | Cancel the in-flight LLM task | Generation stops; we stop paying for tokens nobody will hear. |
| c | Truncate history to the last **spoken** character | The model must remember what you actually heard, not what it generated but never played. |

`LiveSession` tracks `spoken_chars` — the offset of the assistant text whose
audio has been fully sent — and commits only that prefix to history. A
`truncated: true` flag rides along so the UI can mark the cut-off reply.

A `vad_barge_in_delay_ms` grace period (default 240 ms) stops the assistant's
own tail from immediately interrupting itself.

---

## Directory layout

```
live-server/                     Python / FastAPI pipeline
├── app/
│   ├── main.py                  FastAPI app, WS endpoint, model registry
│   ├── config.py                env-driven settings (LIVE_* prefix)
│   ├── protocol.py              binary wire format  ← mirrors src/live/protocol.ts
│   ├── session.py               per-connection state machine + barge-in
│   ├── vad.py                   Silero VAD + energy fallback + segmenter
│   ├── stt.py                   streaming faster-whisper + text segmenter
│   ├── tts.py                   Piper (VITS) / Kokoro / espeak / silence
│   ├── llm.py                   local OpenAI-compatible streaming client
│   ├── vision.py                async drop-oldest frame buffer
│   ├── audio.py                 PCM, resampling, ring buffer
│   └── __init__.py
├── scripts/download_voices.sh   fetch Piper voices
├── patches/
│   ├── persona.py               ← copy into app/ to enable the identity rules
│   └── test_persona.py          model-free tests for it (27/27)
├── tests/
│   ├── test_pipeline.py         model-free unit tests
│   ├── crosscheck_protocol.py   protocol digest (Python side)
│   └── crosscheck_protocol.mjs  protocol digest (TS side) — must match
├── requirements.txt
├── requirements-gpu.txt
└── env.example

src/live/                        Browser side (TypeScript)
├── protocol.ts                  wire format  ← mirrors app/protocol.py
├── mic-worklet.js               capture, resample, 20 ms framing
├── playback-worklet.js          jitter buffer + instant flush
├── audio.ts                     MicCapture
├── playback.ts                  TtsPlayback
├── vision.ts                    VisionCapture (camera/screen @ 1-2 fps)
├── transport.ts                 WebSocket, backoff, backpressure
├── use-live-session.ts          React hook (the whole state machine)
└── live-session-panel.tsx       full-screen UI
```

---

## Setup

### 1. Backend

```bash
cd live-server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp env.example .env
```

### 2. A Piper TTS voice

```bash
chmod +x scripts/download_voices.sh
./scripts/download_voices.sh en_US-amy-medium
```

Or point `LIVE_TTS_BACKEND=kokoro` at Kokoro instead. For a wiring test with
no model at all, set `LIVE_TTS_BACKEND=none` (the pipeline emits timed silence
so you can validate transport and interruption).

### 3. A local LLM

Any OpenAI-compatible server on localhost works.

**llama.cpp**
```bash
llama-server -m model.gguf --port 8080 --jinja
# → LIVE_LLM_BASE_URL=http://127.0.0.1:8080/v1
```

**Ollama**
```bash
ollama serve
ollama pull llama3.2
# → LIVE_LLM_BASE_URL=http://127.0.0.1:11434/v1 , LIVE_LLM_MODEL=llama3.2
```

**Vision** (optional) — use a multimodal model and set `LIVE_LLM_MODEL` to it
(e.g. `qwen2-vl` on Ollama, or a llama.cpp build with `--mmproj`). Recent
frames are attached to the newest user turn as `image_url` parts.

### 4. Run it

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Check readiness — this tells you exactly which models loaded:

```bash
curl -s localhost:8787/health | python3 -m json.tool
```

### 5. Frontend

The web app is unchanged; the live module is additive and adds **no new npm
dependencies** (browser `WebSocket`, `AudioWorklet`, `getUserMedia` only).

Mount the panel anywhere:

```tsx
import { LiveSessionPanel } from "@/live";

const [open, setOpen] = useState(false);

// …
<LiveSessionPanel open={open} onClose={() => setOpen(false)} vision />
```

Or drive the hook directly:

```tsx
import { useLiveSession } from "@/live";

const live = useLiveSession({ vision: true, visionFps: 1.5 });
// live.state · live.turns · live.start() · live.interrupt() · live.sendText()
```

Browsers require a user gesture before audio starts, so call `start()` from a
click handler.

---

## Wire protocol

One binary frame per WebSocket message:

```
+--------+--------+------------------+
| 1 byte | 1 byte | N bytes          |
| type   | flags  | payload          |
+--------+--------+------------------+
```

| type | name | direction | payload |
|------|------|-----------|---------|
| `0x01` | `AUDIO_MIC` | C → S | Int16LE mono PCM @ 16 kHz, 320 samples (20 ms) |
| `0x02` | `AUDIO_OUT` | S → C | Int16LE mono PCM @ TTS rate, ~20 ms chunks |
| `0x03` | `IMAGE` | C → S | JPEG/WebP/PNG; `flags` = codec |
| `0x10` | `CONTROL` | both | UTF-8 JSON |

`session.start` additionally carries an optional `instructions` string — the
identity and manners rules the web app wants the local model to follow. It is
**omitted entirely when unset**, so a browser that predates the field sends a
byte-identical payload and an older pipeline keeps working. See
[Persona](#persona--making-live-mode-answer-as-the-same-assistant) below.

```json
{"type":"session.start","sampleRate":16000,"visionContext":1,
 "instructions":"You are Jarvis, a calm, precise AI assistant. …"}
```

`flags` bit `0x01` on an audio frame marks the last chunk of an utterance.

Control messages (`type` field):

| Direction | Messages |
|-----------|----------|
| C → S | `session.start`, `session.stop`, `text`, `interrupt`, `audio.end` |
| S → C | `session.ready`, `state`, `transcript.partial`, `transcript.final`, `response.delta`, `response.done`, `CLEAR_BUFFER`, `error` |

**These two files are one contract and must be changed together:**
`live-server/app/protocol.py` and `src/live/protocol.ts`.

To prove they still agree:

```bash
python3 live-server/tests/crosscheck_protocol.py > /tmp/py.txt
node     live-server/tests/crosscheck_protocol.mjs > /tmp/ts.txt
diff <(grep -v OK$ /tmp/py.txt) <(grep -v OK$ /tmp/ts.txt)   # must be empty
```

---

## Tests

```bash
pip install pytest pytest-asyncio
python3 -m pytest tests -q
```

The suite is deliberately model-free — it covers the protocol, framing, ring
buffer eviction, VAD debouncing (a single blip must *not* open a turn),
sentence segmentation, and speech-text stripping. It runs in under a second and
needs no model downloads.

---

## Performance notes

| Knob | Default | Effect |
|------|---------|--------|
| `LIVE_STT_MODEL` | `base` | `small`/`large-v3` on GPU for accuracy; `tiny` for minimum latency |
| `LIVE_STT_COMPUTE_TYPE` | `int8` | use `float16` + `LIVE_STT_DEVICE=cuda` on NVIDIA |
| `LIVE_TTS_BACKEND` | `piper` | Kokoro is more natural, slightly slower |
| `LIVE_VAD_MIN_SILENCE_MS` | `500` | lower = faster turn-taking, more mid-sentence cuts |
| `LIVE_VAD_MIN_SPEECH_MS` | `200` | lower = catches short utterances like "hello" |
| `LIVE_VAD_BARGE_IN_DELAY_MS` | `240` | raise if the assistant interrupts itself |
| `LIVE_VISION_MAX_FRAMES` | `2` | frames attached to each prompt |
| `visionFps` (client) | `1.5` | 1-2 is plenty; this is not a video call |
| playback `jitterMs` | `120` | raise for jittery networks, lower for less latency |

**Expected latency** on a modern laptop CPU (whisper `base` + piper):
speech-end → transcript ≈ 200-400 ms, plus first audio ≈ 300-600 ms.

---

## Troubleshooting

**`/health` shows `stt_loaded: false`** — faster-whisper failed to import or
download the model. Run `pip install -r requirements.txt` again and check the
startup log.

**`tts_loaded: false`, or Piper voice not found** — run
`scripts/download_voices.sh <voice>` and point `LIVE_TTS_DATA_DIR` at the
download directory.

**`llm.ok: false`** — the model server is not running or the base URL is wrong.
`curl $LIVE_LLM_BASE_URL/models` should return JSON.

**Assistant never responds / transcripts are empty** — the server only submits
a turn after `LIVE_VAD_MIN_SILENCE_MS` of silence. If you pause mid-sentence
and hear nothing, lower it to ~350.

**Assistant interrupts itself** — raise `LIVE_VAD_BARGE_IN_DELAY_MS`.

**Choppy or robotic audio** — the jitter buffer is starving. Raise the client
`jitterMs`, or check CPU saturation: Whisper, TTS and the LLM all compete for
the same cores.

**WebSocket fails in the browser** — add your dev origin to
`LIVE_CORS_ORIGINS`, and note the pipeline must be reachable from the machine
running the browser. If you are on a remote host, tunnel it
(`ssh -L 8787:127.0.0.1:8787 …`) and use `ws://localhost:8787/ws/live`.

---

## Persona — making live mode answer as the same assistant

Chat and live mode run **two different models on two different stacks**. Chat
goes to Groq/HuggingFace, which the web app can configure with a system prompt
it controls. Live mode runs a model on your own machine, which has never heard
of this application — ask it *"who made you?"* and it answers **OpenAI**, or
Google, or Meta, because from its point of view that is true. It is answering
correctly about itself and wrong about who built the thing it is running inside.

The fix is `persona.py`. It has no dependencies and no imports beyond `typing`,
so it cannot conflict with anything already in `app/`.

### 1. Copy the module in

```bash
cp live-server/patches/persona.py live-server/app/persona.py
```

Verify it landed before touching anything else:

```bash
python3 live-server/patches/test_persona.py     # expect 27/27 passed
```

### 2. Edit `app/session.py` — two edits

**a. Add the import and a holder** near the top, beside the existing `LiveSession`
class:

```python
from .persona import LivePersona, read_instructions   # if app/ is a package
```

```python
class LiveSession:
    def __init__(self, ...):
        ...
        self.persona = LivePersona()          # ← add
```

**b. Read the field in the `session.start` handler.** Wherever that message is
decoded today, add one line right after the payload is available:

```python
if msg.get("type") == "session.start":
    self.persona.load_from(msg)              # ← add
    ...
```

`load_from` is safe on an old payload: a missing key stores `""` and changes
nothing.

**c. Clear it on `session.stop`** so the next browser session cannot inherit
the previous one's identity:

```python
if msg.get("type") == "session.stop":
    self.persona.clear()                     # ← add
```

### 3. Edit `app/llm.py` — one edit

Find where the system prompt is assembled each turn (whatever your variable is
called — `system_prompt`, `base_prompt`, a messages list built in
`LiveSession`), and route it through the session's persona:

```python
# before
system_prompt = self.base_prompt

# after
system_prompt = self.persona.apply(self.base_prompt)
```

If the prompt is built somewhere with no reference to the session, pass it in
instead: `llm.stream(persona=self.persona, …)`.

**Appending is the whole mechanism.** The pipeline's own preamble usually opens
*"You are a helpful assistant."* Instructions placed *before* it get diluted;
placed *after* it, they are the most recent thing the model read and therefore
the ones it follows. `compose_prompt()` owns that ordering so there is exactly
one place to look when the identity rules stop being followed.

### 4. Confirm it works

Add the persona's summary to `/health` — it reports lengths only, never the
text, which contains the user's standing instructions:

```python
"persona": session.persona.status(),
```

Start live mode, then:

```bash
curl -s localhost:8787/health | python3 -m json.tool
```

```json
"persona": { "instructions_received": true, "instructions_chars": 3122 }
```

`instructions_received: true` with a plausible character count means the field
arrived and was accepted. Then just ask it **"who made you?"** out loud.

### What is sent, and what is deliberately not

| Sent | Not sent |
|------|----------|
| Identity — who built Jarvis, and the GitHub handle | The default house style (`**bold**`, bullet lists, tables, code fences) |
| Manners — never curt, no disclaimer openers, let venting finish | Its formatting rules, because TTS reads punctuation aloud |
| Spoken-output rules — plain prose, spell out `(` as "open parenthesis" | |
| Your own standing instructions and active persona from Settings | |

That last row is the point of the whole thing: **what you have written in
Settings is honoured in voice mode too.** Chat and live mode stop disagreeing
about who Jarvis is.

The default house style is excluded on purpose. It is written for a screen, and
a voice engine asked to produce `**bold**` produces "asterisk asterisk bold
asterisk asterisk". `VOICE_FORMAT_RULES` in `src/lib/live-persona.ts` carries the
rules that survive speech, and claims to override formatting instructions —
including your own, which is the one case that genuinely cannot be honoured
when the reply is going to be read out loud.

### Already applied on the browser side

Nothing to do in `src/` — this was wired for you:

- `src/lib/live-persona.ts` — composes the block (identity → manners →
  spoken-output → your instructions).
- `src/convex/workspace.ts` — `workspace.livePersona` query returns your
  written instructions and active persona, without the house style.
- `src/live/use-live-session.ts` — fetches it and sends it on `session.start`,
  set before `connect()` so it lands in the first frame.

Passing `instructions` to `useLiveSession({ instructions: "…" })` overrides all
of it, if you would rather drive the local model yourself.
(`ssh -L 8787:127.0.0.1:8787 …`) and use `ws://localhost:8787/ws/live`.
