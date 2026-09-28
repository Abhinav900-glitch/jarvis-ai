/**
 * Local live voice + vision pipeline — browser side.
 *
 * Server counterpart: `live-server/app/`. The wire protocol in
 * `src/live/protocol.ts` mirrors `live-server/app/protocol.py`; change both
 * together.
 *
 * Typical use:
 *
 *   const [open, setOpen] = useState(false);
 *   <LiveSessionPanel open={open} onClose={() => setOpen(false)} vision />
 */

export { LiveSessionPanel } from "./live-session-panel";
export type { LiveSessionPanelProps } from "./live-session-panel";
export { useLiveSession } from "./use-live-session";
export type { LiveTurn, LiveSession, LiveSessionState, LiveSessionOptions } from "./use-live-session";
export { LiveTransport } from "./transport";
export type { ConnectionStatus, TransportCallbacks } from "./transport";
export { MicCapture } from "./audio";
export type { MicCaptureOptions } from "./audio";
export { TtsPlayback } from "./playback";
export type { PlaybackOptions } from "./playback";
export { VisionCapture } from "./vision";
export type { VisionSource, VisionCaptureOptions } from "./vision";
export * from "./protocol";
