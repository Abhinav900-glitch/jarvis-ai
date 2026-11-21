// ---------------------------------------------------------------------------
// OfflineTranscriptDialog — read the last conversation with no connection.
//
// A saved copy is not the live chat: nothing here edits, regenerates, rates or
// deletes a message, because every one of those actions is a server write. The
// dialog says "read-only" where the chat would offer controls, and keeps the
// ways out — close, or forget the local copy — close at hand.
// ---------------------------------------------------------------------------

import { BookOpen, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownMessage } from "@/components/markdown-message";
import type { CachedTranscript } from "@/lib/transcript-cache";

export interface OfflineTranscriptDialogProps {
  transcript: CachedTranscript | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onForget: () => void;
}

function savedLabel(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "earlier";
  }
}

export function OfflineTranscriptDialog({
  transcript,
  open,
  onOpenChange,
  onForget,
}: OfflineTranscriptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-4">
          <p className="hud-label hud-label-cyan flex items-center gap-1.5">
            {transcript ? <WifiOff className="size-3" /> : <BookOpen className="size-3" />}
            Saved offline
          </p>
          <DialogTitle className="mt-1 truncate pr-8 text-base">
            {transcript?.title.trim() || "Saved conversation"}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            A read-only copy from {transcript ? savedLabel(transcript.savedAt) : "earlier"}.
            {transcript ? ` ${transcript.messages.length} messages.` : ""} It stays on
            this device and is removed when you sign out.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {transcript ? (
            <div className="space-y-6">
              {transcript.messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm leading-6">
                      {message.content}
                      {message.imageUrl ? (
                        <img
                          src={message.imageUrl}
                          alt=""
                          loading="lazy"
                          className="mt-2 max-h-60 rounded-lg border border-border/60 object-cover"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Jarvis
                    </p>
                    {message.content ? (
                      <div className="text-sm leading-6">
                        <MarkdownMessage content={message.content} />
                      </div>
                    ) : null}
                    {message.imageUrl ? (
                      <img
                        src={message.imageUrl}
                        alt=""
                        loading="lazy"
                        className="max-h-72 rounded-lg border border-border/60 object-cover"
                      />
                    ) : null}
                    {message.images && message.images.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {message.images.map((url) => (
                          <img
                            key={url}
                            src={url}
                            alt=""
                            loading="lazy"
                            className="max-h-48 w-full rounded-lg border border-border/60 object-cover"
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              There is no saved conversation on this device yet. Open a chat while
              online once and it will be here next time.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            Replies and links need a connection.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={onForget}
          >
            <Trash2 className="size-3.5" />
            Forget
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
