// ---------------------------------------------------------------------------
// Gesture arbitration: turning a stream of "what the hand looks like right
// now" into a small number of deliberate Jarvis actions.
//
// The hard part is not recognising a gesture, it is not firing on noise. A
// hand tracker classifies every frame, so the same pose flickers between
// `fist` and `pinch` for a few frames while a person holds still. Fire directly
// on classification and Jarvis executes four actions while you make one
// gesture. So nothing is emitted from a single frame: a gesture has to be seen
// consistently AND held before it counts, and it has to be released before it
// can fire again.
//
// Hands and touch share one vocabulary on purpose. Two independent control
// schemes would mean every action needed two implementations and two sets of
// conflicts; one vocabulary means the bindings are written once.
//
// Pure and dependency-free, so it can be unit-tested without a camera.
// ---------------------------------------------------------------------------

/** A pose, whatever produced it. */
export type Gesture =
  | "idle"
  | "open_palm"
  | "fist"
  | "pinch"
  | "point"
  | "peace"
  | "thumbs_up";

export type GestureSource = "hand" | "touch";

/** What Jarvis should actually do. Deliberately small and reversible. */
export type GestureAction =
  | "none"
  | "interrupt"
  | "send"
  | "pause_listening"
  | "resume_listening"
  | "new_chat"
  | "cycle_persona";

export interface GestureBinding {
  gesture: Gesture;
  action: GestureAction;
  /** Shown in the palette / help text. */
  label: string;
}

/**
 * Hands and touch, expressed in the same vocabulary.
 *
 * Touch equivalents are chosen to be reachable one-handed and to not collide
 * with ordinary tapping on the transcript underneath.
 */
export const HAND_BINDINGS: readonly GestureBinding[] = [
  // Interrupting is the most valuable thing a gesture can do, so it gets the
  // easiest gesture: a raised open palm is both the most reliable pose to
  // detect and the clearest "stop" signal.
  { gesture: "open_palm", action: "interrupt", label: "Interrupt Jarvis" },
  // A pinch is a deliberate, slow-to-make shape, which makes it a good "commit"
  // gesture for sending rather than something that fires on a passing hand.
  { gesture: "pinch", action: "send", label: "Send what I said" },
  { gesture: "fist", action: "pause_listening", label: "Pause listening" },
  { gesture: "peace", action: "resume_listening", label: "Resume listening" },
  { gesture: "thumbs_up", action: "new_chat", label: "Start a new chat" },
  { gesture: "point", action: "cycle_persona", label: "Switch persona" },
];

export const TOUCH_BINDINGS: readonly GestureBinding[] = [
  { gesture: "open_palm", action: "interrupt", label: "Two-finger tap: interrupt" },
  { gesture: "pinch", action: "send", label: "Pinch: send" },
  { gesture: "thumbs_up", action: "new_chat", label: "Long press: new chat" },
  { gesture: "peace", action: "resume_listening", label: "Swipe up: resume" },
  { gesture: "fist", action: "pause_listening", label: "Swipe down: pause" },
];

const BY_SOURCE: Record<GestureSource, ReadonlyMap<Gesture, GestureBinding>> = {
  hand: new Map(HAND_BINDINGS.map((b) => [b.gesture, b])),
  touch: new Map(TOUCH_BINDINGS.map((b) => [b.gesture, b])),
};

/** The action a gesture means, or "none" when it is unbound or idle. */
export function resolveAction(
  gesture: Gesture,
  source: GestureSource,
): GestureAction {
  if (gesture === "idle") return "none";
  return BY_SOURCE[source].get(gesture)?.action ?? "none";
}

export interface ArbiterOptions {
  /** Frames of the same gesture before it is believed. */
  confirmFrames?: number;
  /** How long a confirmed gesture must be held, ms. */
  holdMs?: number;
  /** Ignore detections this long after the last one (tracker paused/lost). */
  staleMs?: number;
  now?: () => number;
}

export interface ArbiterEvent {
  gesture: Gesture;
  action: GestureAction;
  source: GestureSource;
}

/**
 * Confirms gestures and emits each one at most once per entry.
 *
 * Requires three things before firing: the same pose on N consecutive frames,
 * held for a minimum duration, and preceded by an `idle` so a sustained pose
 * fires once rather than on every frame it is held.
 */
export class GestureArbiter {
  private readonly confirmFrames: number;
  private readonly holdMs: number;
  private readonly staleMs: number;
  private readonly now: () => number;

  private candidate: Gesture = "idle";
  private candidateCount = 0;
  private candidateSince = 0;
  private lastSeenAt = 0;
  /** Set once a gesture has fired; cleared only by leaving it. */
  private latched = false;

  constructor(options: ArbiterOptions = {}) {
    this.confirmFrames = options.confirmFrames ?? 3;
    this.holdMs = options.holdMs ?? 180;
    this.staleMs = options.staleMs ?? 500;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Feed one detection. Returns an event when a gesture has just been
   * confirmed, otherwise null.
   */
  push(gesture: Gesture, source: GestureSource): ArbiterEvent | null {
    const t = this.now();
    // Compare against the PREVIOUS detection before overwriting it, otherwise
    // the gap is always zero and the staleness check can never fire.
    if (this.lastSeenAt !== 0 && t - this.lastSeenAt > this.staleMs) this.reset();
    this.lastSeenAt = t;

    if (gesture !== this.candidate) {
      this.candidate = gesture;
      this.candidateCount = 1;
      this.candidateSince = t;
      if (gesture === "idle") this.latched = false;
      return null;
    }

    this.candidateCount += 1;
    if (gesture === "idle") return null;

    const confirmed =
      this.candidateCount >= this.confirmFrames && t - this.candidateSince >= this.holdMs;
    if (!confirmed || this.latched) return null;

    this.latched = true;
    return { gesture, action: resolveAction(gesture, source), source };
  }

  /** Forget everything. Call when the overlay closes. */
  reset(): void {
    this.candidate = "idle";
    this.candidateCount = 0;
    this.candidateSince = 0;
    this.latched = false;
  }
}

/**
 * Classify 21 hand landmarks into a pose.
 *
 * Kept separate from the arbiter because it is the only part that needs a hand
 * tracker, and because it is worth testing against recorded landmark data.
 * `handSpan` is wrist-to-middle-tip distance normalised by hand size, so it
 * holds up across distances from the camera.
 */
export function classifyHand(
  landmarks: Array<{ x: number; y: number; z: number }>,
  options: { pinchThreshold?: number } = {},
): Gesture {
  if (!landmarks || landmarks.length < 21) return "idle";

  const pinchThreshold = options.pinchThreshold ?? 0.055;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const wrist = landmarks[0];
  const middleTip = landmarks[12];
  const handSpan = Math.max(1e-6, dist(wrist, middleTip));

  // Pinch first: a pinched hand also reads as "fist" to finger-extension
  // counting, and the user's intent is clearly the more specific one.
  if (dist(landmarks[4], landmarks[8]) / handSpan < pinchThreshold) return "pinch";

  // Extended = fingertip further from the wrist than its own middle joint,
  // relative to hand size so it is scale-invariant.
  const extended = (tip: number, pip: number) =>
    (dist(wrist, landmarks[tip]) - dist(wrist, landmarks[pip])) / handSpan > 0.08;

  const fingers = [
    extended(8, 6), // index
    extended(12, 10), // middle
    extended(16, 14), // ring
    extended(20, 18), // pinky
  ];
  const count = fingers.filter(Boolean).length;

  if (count === 0) return "fist";
  if (count === 4) return "open_palm";
  if (count === 2 && fingers[0] && fingers[1]) return "peace";
  if (count === 1 && fingers[0]) return "point";

  // Thumb up: the thumb tip sits well above the wrist while nothing else is
  // extended, and points away from the curled fingers.
  const thumbExtended =
    dist(wrist, landmarks[4]) / handSpan > 0.7 &&
    landmarks[4].y < landmarks[0].y - handSpan * 0.2;
  if (thumbExtended) return "thumbs_up";

  return "idle";
}
