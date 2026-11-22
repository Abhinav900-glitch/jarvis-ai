// ---------------------------------------------------------------------------
// ManyChat panel.
//
// One job: send a text from Jarvis to a ManyChat subscriber on Instagram,
// WhatsApp, Messenger or Telegram. The subscriber ID is the numeric ID from
// the contact card, not a username or a PSID.
//
// The panel states the account the key belongs to instead of pretending a
// generic "Connect" toggle: ManyChat keys are per-page, so the page name is
// the honest confirmation that the right bot answered.
// ---------------------------------------------------------------------------

import { useAction } from "convex/react";
import { Loader2, Search, Send, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";

interface StatusResponse {
  configured: boolean;
  pageName: string | null;
  pageId: string | null;
  error: string | null;
}

interface SubscriberResponse {
  id: string;
  name: string;
  profilePic: string | null;
  liveChatUrl: string | null;
}

export interface ManyChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The newest assistant reply, offered as a starting point. */
  draft: string;
}

export function ManyChatPanel({
  open,
  onOpenChange,
  draft,
}: ManyChatPanelProps) {
  const checkStatus = useAction(api.manychat.status);
  const findSubscriber = useAction(api.manychat.subscriber);
  const sendText = useAction(api.manychat.sendText);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [subscriberId, setSubscriberId] = useState("");
  const [person, setPerson] = useState<SubscriberResponse | null>(null);
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setStatus(null);
      setStatusError(null);
      void checkStatus({})
        .then((result) => {
          if (!cancelled) setStatus(result as StatusResponse);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setStatusError(
              err instanceof Error ? err.message : "Could not reach ManyChat.",
            );
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, checkStatus]);

  const lookup = async () => {
    if (!subscriberId.trim()) return;
    setLooking(true);
    setPerson(null);
    try {
      const result = (await findSubscriber({
        subscriberId: subscriberId.trim(),
      })) as SubscriberResponse;
      setPerson(result);
      toast.success(`Found ${result.name}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not look up that subscriber.",
      );
    } finally {
      setLooking(false);
    }
  };

  const send = async () => {
    if (!subscriberId.trim() || !message.trim()) return;
    setSending(true);
    try {
      const result = (await sendText({
        subscriberId: subscriberId.trim(),
        text: message,
      })) as
        | { ok: true; messageId: number | null }
        | { ok: false; error: string };
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Message sent through ManyChat.", {
        description:
          "ManyChat's 24-hour window and message-tag rules still apply to the channel.",
      });
      setMessage("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "ManyChat could not send that.",
      );
    } finally {
      setSending(false);
    }
  };

  const missing = status !== null && !status.configured;
  const ready = status?.configured === true && !status.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%_-_2rem)] max-w-lg gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <p className="hud-label hud-label-cyan">ManyChat</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-base">
            <Send className="size-4 text-primary" />
            Message a subscriber
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            Sends through the ManyChat account this API key belongs to.
            Instagram, WhatsApp, Messenger and Telegram all use the same call;
            the channel decides whether the 24-hour window allows it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5 text-[11px]">
            {status === null && !statusError ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Checking the account…
              </span>
            ) : statusError ? (
              <span className="text-destructive">{statusError}</span>
            ) : missing ? (
              <span className="text-muted-foreground">
                <span className="font-mono text-foreground">
                  MANYCHAT_API_KEY
                </span>{" "}
                is not configured. Add the ManyChat account API key (Settings →
                API) in the Keys tab; MANYCHAT_AI_API_KEY is accepted as an
                alias.
              </span>
            ) : status?.error ? (
              <span className="text-amber-700 dark:text-amber-400">
                {status.error}. Regenerate the account API token in ManyChat
                under Settings → API and save it as{" "}
                <span className="font-mono">MANYCHAT_API_KEY</span> — this must
                be the Public API token, not an AI provider key.
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <UserRound className="size-3.5" />
                Connected to {status?.pageName ?? "the ManyChat page"}
                {status?.pageId ? ` · ${status.pageId}` : ""}
              </span>
            )}
          </div>

          <div>
            <label
              htmlFor="manychat-subscriber"
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
            >
              Subscriber ID
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="manychat-subscriber"
                value={subscriberId}
                onChange={(event) => {
                  setSubscriberId(event.target.value.replace(/[^\d]/g, ""));
                  setPerson(null);
                }}
                disabled={!ready}
                placeholder="e.g. 12345678"
                inputMode="numeric"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                disabled={!ready || !subscriberId.trim() || looking}
                onClick={() => void lookup()}
              >
                {looking ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Find
              </Button>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              The numeric ID on the contact card — not a username, PSID or phone
              number.
            </p>
          </div>

          {person ? (
            <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
              {person.profilePic ? (
                <img
                  src={person.profilePic}
                  alt=""
                  className="size-8 rounded-full object-cover"
                />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="size-4" />
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{person.name}</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {person.id}
                </p>
              </div>
            </div>
          ) : null}

          <div>
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="manychat-message"
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Message
              </label>
              {draft ? (
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline"
                  onClick={() => setMessage(draft.slice(0, 2_000))}
                >
                  Use latest reply
                </button>
              ) : null}
            </div>
            <textarea
              id="manychat-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              disabled={!ready}
              rows={5}
              maxLength={2_000}
              placeholder="Write the message to send…"
              className="mt-1.5 w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground/70">
              {message.length}/2000
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            Sending outside the window needs a message tag set in ManyChat.
          </span>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={
              !ready || sending || !subscriberId.trim() || !message.trim()
            }
            onClick={() => void send()}
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            Send
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
