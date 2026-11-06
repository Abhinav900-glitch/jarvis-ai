/**
 * `LiveSessionPanel` — full-screen live voice + vision interface.
 *
 * Styled to match the existing JARVIS HUD language (cyan on near-black,
 * monospace readouts) so it feels native to the app rather than bolted on.
 *
 * The panel is a pure view over `useLiveSession`; all pipeline behaviour lives
 * in the hook.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CameraOff, Mic, MicOff, Send, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLiveSession, type LiveSessionOptions } from "./use-live-session";

export interface LiveSessionPanelProps extends LiveSessionOptions {
  open: boolean;
  onClose: () => void;
}

const STATE_LABEL: Record<string, string> = {
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "PROCESSING",
  speaking: "SPEAKING",
};

/** 24-bar meter driven by the live mic level. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  return (
    <div className="flex h-8 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => {
        // Height comes from the measured level alone. The movement between bars
        // is a CSS animation with a per-bar delay, so nothing here depends on
        // the clock and the render stays pure.
        const height = active ? Math.max(2, level * 30) : 2;
        return (
          <div
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-[height] duration-75",
              active ? "bg-cyan-300/90 jarvis-meter-bar" : "bg-cyan-500/20",
            )}
            style={
              active
                ? { height: `${height}px`, animationDelay: `${(i % 8) * 90}ms` }
                : { height: `${height}px` }
            }
          />
        );
      })}
    </div>
  );
}

export function LiveSessionPanel({ open, onClose, ...options }: LiveSessionPanelProps) {
  const session = useLiveSession(options);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.turns, session.partialTranscript, open]);

  const handleClose = () => {
    void session.stop();
    onClose();
  };

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    session.sendText(text);
    setDraft("");
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[90] flex flex-col bg-[#020610]/97 backdrop-blur-sm"
      >
        {/* Top bar */}
        <div className="flex items-center gap-3 border-b border-cyan-400/15 px-5 py-3">
          <span className="inline-block size-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">
            Live Voice + Vision
          </span>
          <span
            className={cn(
              "ml-2 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
              session.status === "open"
                ? "border-cyan-400/30 text-cyan-300"
                : "border-amber-400/30 text-amber-300",
            )}
          >
            {session.status}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void session.toggleVision()}
              disabled={!session.active}
              className={cn(
                "h-8 gap-1.5 text-xs",
                session.visionActive && "text-cyan-300 hover:text-cyan-200",
              )}
              title={session.visionActive ? "Stop sending camera frames" : "Send camera frames"}
            >
              {session.visionActive ? <Camera className="size-3.5" /> : <CameraOff className="size-3.5" />}
              {session.visionActive ? "Vision on" : "Vision off"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClose}
              className="h-8 gap-1.5 text-xs"
            >
              <X className="size-3.5" />
              End
            </Button>
          </div>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mx-auto max-w-3xl space-y-5">
            {session.turns.length === 0 && !session.partialTranscript && (
              <div className="pt-16 text-center">
                <p className="text-sm text-cyan-100/60">
                  {session.active
                    ? "Listening — just start talking."
                    : "Press Start to open a live session."}
                </p>
              </div>
            )}

            {session.turns.map((turn) => (
              <div key={turn.id} className="space-y-2">
                {turn.user && (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl rounded-br-sm border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm leading-6 text-cyan-50/90">
                      {turn.user}
                    </p>
                  </div>
                )}
                {turn.assistant && (
                  <div className="flex justify-start">
                    <p className="max-w-[92%] rounded-2xl rounded-bl-sm border border-cyan-400/15 bg-cyan-500/[0.06] px-4 py-2.5 text-sm leading-6 text-cyan-100/85">
                      <span className="mr-2 font-mono text-[10px] uppercase tracking-widest text-cyan-400/80">
                        Jarvis
                      </span>
                      {turn.assistant}
                      {turn.truncated && (
                        <span className="ml-1 text-cyan-400/50" title="Interrupted">
                          …
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {session.partialTranscript && (
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-sm border border-cyan-400/15 bg-cyan-400/[0.06] px-4 py-2.5 text-sm leading-6 text-cyan-100/60 italic">
                  {session.partialTranscript}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Status + controls */}
        <div className="border-t border-cyan-400/15 px-5 py-4">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
            {session.error && (
              <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {session.error}
              </div>
            )}

            {/* This panel speaks to the local Python pipeline and nothing
                else; the socket retries forever, so without a word here a
                session with no server looks like a stuck "reconnecting". */}
            {session.active && session.status !== "open" && (
              <div className="w-full rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-200">
                Waiting for the local live pipeline
                {options.url ? ` at ${options.url}` : " (see live-server/README.md)"}.
                Start it with <code className="font-mono">uvicorn app.main:app</code>, or end
                this session and use <b>Live voice + vision</b> in the toolbar for the
                in-app call.
              </div>
            )}

            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.35em] text-cyan-200/80">
                <span className="inline-block size-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
                {STATE_LABEL[session.state] ?? session.state}
                <span className="inline-block size-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
              </div>
              <LevelMeter level={session.micLevel} active={session.state === "listening"} />
            </div>

            <div className="flex w-full items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Type to send a message, or just speak…"
                rows={1}
                className="min-h-[38px] flex-1 resize-none border-cyan-400/20 bg-cyan-500/[0.04] text-sm"
              />

              {!session.active ? (
                <Button
                  onClick={() => void session.start()}
                  className="h-[38px] gap-1.5 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25"
                >
                  <Mic className="size-4" />
                  Start
                </Button>
              ) : (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={session.interrupt}
                    disabled={!session.assistantSpeaking}
                    title="Interrupt Jarvis"
                    className="size-[38px] text-cyan-300 hover:bg-cyan-500/15"
                  >
                    <Square className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void session.stop()}
                    title="End session"
                    className="size-[38px] text-cyan-300/70 hover:bg-cyan-500/15"
                  >
                    <MicOff className="size-4" />
                  </Button>
                </>
              )}

              <Button
                size="icon"
                variant="ghost"
                onClick={handleSubmit}
                disabled={!draft.trim() || !session.active}
                title="Send"
                className="size-[38px]"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
