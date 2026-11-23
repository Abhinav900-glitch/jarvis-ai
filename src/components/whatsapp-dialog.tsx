// ---------------------------------------------------------------------------
// WhatsApp mode.
//
// The assistant has a phone number of its own: someone saves it, messages it
// from WhatsApp, and the reply arrives in the same chat. The dashboard is only
// a hand-off screen — the conversation itself never happens here, which is the
// point. ManyChat owns the WhatsApp Business connection; this deployment owns
// the brain behind it.
//
// The number is configuration because WhatsApp issues numbers through Meta (or
// a provider connected to Meta), not through application code. When it is not
// set the dialog says exactly what is missing instead of showing a fake number.
// ---------------------------------------------------------------------------

import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, Loader2, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
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

interface WhatsappInfo {
  display: string | null;
  number: string | null;
  link: string | null;
  region: {
    code: string;
    name: string;
    callingCode: string;
  } | null;
  channelReady: boolean;
  twilioWebhook: string | null;
  envName: string;
}

/**
 * Free-path setup for Twilio's WhatsApp Sandbox.
 *
 * The Sandbox is the only no-cost WhatsApp sender available today, but it is
 * shared and every tester must join it before Twilio will deliver their
 * messages. Keeping those two caveats next to the webhook URL prevents the
 * common "I added keys, why does nothing happen?" dead end.
 */
function TwilioSandboxHelp({ webhook }: { webhook: string | null }) {
  const getWebhookUrl = useAction(api.manychat.twilioWebhookUrl);
  const [copying, setCopying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  if (!webhook) return null;

  // The secret is appended server-side: the operator pastes one finished URL
  // into Twilio's single-line field instead of editing a 32-character key into
  // it by hand, which is the step that usually goes wrong.
  const copyFullWebhook = async () => {
    setCopying(true);
    try {
      const result = await getWebhookUrl();
      if (!result.url) {
        toast.error("Add TWILIO_WEBHOOK_SECRET in the Keys tab first.");
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setCopiedWebhook(true);
      toast.success("Webhook URL copied. Paste it into Twilio and save.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not copy the webhook URL.",
      );
    } finally {
      setCopying(false);
    }
  };

  return (
    <details className="rounded-lg border border-border/60 px-3 py-2">
      <summary className="cursor-pointer text-[11px] font-medium text-foreground">
        Free test option: Twilio Sandbox
      </summary>
      <div className="mt-2 space-y-1.5 text-[10px] leading-4 text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">1.</span> Open{" "}
          <a
            href="https://www.twilio.com/console/sms/whatsapp/sandbox"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-border underline-offset-2 hover:text-foreground"
          >
            Twilio&apos;s WhatsApp Sandbox
          </a>{" "}
          and accept the terms. From your phone, send the displayed{" "}
          <span className="font-mono text-foreground">join …</span> code to the
          number shown (usually{" "}
          <span className="font-mono text-foreground">+14155238886</span>).
        </p>
        <p>
          <span className="font-medium text-foreground">2.</span> In{" "}
          <span className="text-foreground">Sandbox settings → Sandbox
          configuration → When a Message Comes in</span>, paste the copied URL
          and save. On a trial console, use{" "}
          <span className="text-foreground">Receive a message → Custom → Webhook URL</span>
          instead.
        </p>
        <span className="block break-all rounded bg-muted/60 px-1.5 py-1 font-mono text-[9px] text-foreground">
          {webhook}
        </span>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-[10px]"
            disabled={copying}
            onClick={() => void copyFullWebhook()}
          >
            {copying ? (
              <Loader2 className="size-3 animate-spin" />
            ) : copiedWebhook ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copiedWebhook ? "Webhook URL copied" : "Copy full webhook URL"}
          </Button>
          <a
            href="https://www.twilio.com/console/sms/whatsapp/sandbox"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] underline decoration-border underline-offset-2 hover:text-foreground"
          >
            Open Sandbox settings
          </a>
        </div>
        <p>
          The copied URL includes the secret, so paste it exactly as copied.
        </p>
        <p>
          <span className="font-medium text-foreground">3.</span> Connect the same
          number above, then send <span className="text-foreground">hello</span>{" "}
          from the phone that joined. No API key is needed. The Sandbox is for
          testing and expires three days after joining; rejoin if replies stop.
        </p>
      </div>
    </details>
  );
}

export interface WhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsAppDialog({ open, onOpenChange }: WhatsAppDialogProps) {
  const info = useQuery(api.manychat.whatsapp) as WhatsappInfo | undefined;
  const saveNumber = useMutation(api.manychat.saveWhatsapp);
  const [numberDraft, setNumberDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const connectNumber = async (value = numberDraft) => {
    setSaving(true);
    try {
      const saved = await saveNumber({ number: value });
      toast.success(`Connected +${saved.number}.`);
      setNumberDraft("");
      setEditing(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save that number.",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyNumber = async () => {
    if (!info?.display) return;
    try {
      await navigator.clipboard.writeText(info.display);
      setCopied(true);
      toast.success("WhatsApp number copied.");
    } catch {
      toast.error("The browser blocked clipboard access; select the number.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%_-_2rem)] max-w-md gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <p className="hud-label hud-label-cyan">WhatsApp mode</p>
          <DialogTitle className="mt-1 flex items-center gap-2 text-base">
            <MessageCircle className="size-4 text-emerald-600 dark:text-emerald-400" />
            Chat with Jarvis on WhatsApp
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            Message the assistant from any phone. The conversation stays in
            WhatsApp; Jarvis answers there, with the same brain as the web app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {info === undefined ? (
            <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading the assistant's number…
            </span>
          ) : editing || !info.display || !info.number || !info.link ? (
            <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-[11px] leading-5">
              <p className="font-medium text-foreground">
                {info.display
                  ? "Replace the assistant's number"
                  : "Connect the assistant's WhatsApp number"}
              </p>
              <p className="text-muted-foreground">
                Use the number connected to ManyChat, or a Twilio WhatsApp
                sender. Include the country code; spaces and a leading + are
                fine.
              </p>
              <div className="flex gap-2">
                <input
                  value={numberDraft}
                  onChange={(event) =>
                    setNumberDraft(
                      event.target.value.replace(/[^\d+]/g, "").slice(0, 16),
                    )
                  }
                  inputMode="tel"
                  placeholder="14155550123"
                  aria-label="WhatsApp number with country code"
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[11px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={
                    saving || numberDraft.replace(/\D/g, "").length < 8
                  }
                  onClick={() => void connectNumber()}
                >
                  {saving ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                  Connect
                </Button>
              </div>
              {info.display ? (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setEditing(false);
                    setNumberDraft("");
                  }}
                >
                  Cancel
                </button>
              ) : null}
              <p className="text-muted-foreground/80">
                Saving the number only publishes it. Replies start when the
                inbound webhook calls the Jarvis endpoint — a number alone cannot
                answer a WhatsApp message.
              </p>
              <div className="rounded-md border border-dashed border-border/70 px-2.5 py-2">
                <p className="text-[10px] font-medium text-foreground">
                  Free test route
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                  Twilio&apos;s shared Sandbox number. Join it from your phone
                  first, then connect it here.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  className="mt-1.5 h-7 gap-1.5 font-mono text-[10px]"
                  onClick={() => void connectNumber("14155238886")}
                >
                  <Phone className="size-3" />
                  Connect +1 415 523 8886
                </Button>
              </div>
              <TwilioSandboxHelp webhook={info.twilioWebhook} />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Assistant number
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
                  {info.display}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {info.region ? (
                    <>
                      Region:{" "}
                      <span className="text-foreground">
                        {info.region.name}
                      </span>{" "}
                      <span className="font-mono text-muted-foreground/80">
                        ({info.region.code} · {info.region.callingCode})
                      </span>
                    </>
                  ) : (
                    "Region: unknown — the number needs a country code."
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    asChild
                    size="sm"
                    className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <a href={info.link} target="_blank" rel="noreferrer">
                      <Phone className="size-3.5" />
                      Open WhatsApp
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void copyNumber()}
                  >
                    {copied ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {copied ? "Copied" : "Copy number"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      setNumberDraft(info.number ?? "");
                      setEditing(true);
                    }}
                  >
                    Change number
                  </Button>
                </div>
              </div>

              <ol className="space-y-2 text-[11px] leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    1
                  </span>
                  Save the number or tap Open WhatsApp.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    2
                  </span>
                  Send any message from your own phone.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    3
                  </span>
                  The provider forwards it to Jarvis, and the reply lands back
                  in the same chat. Recent messages are remembered per contact.
                </li>
              </ol>

              {!info.channelReady ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                  The number is set, but the reply path is not: add{" "}
                  <span className="font-mono">TWILIO_WEBHOOK_SECRET</span> or{" "}
                  <span className="font-mono">MANYCHAT_WEBHOOK_SECRET</span> in
                  the Keys tab, and point the inbound webhook at the Jarvis
                  endpoint.
                </p>
              ) : (
                <p className="inline-flex items-start gap-1.5 text-[10px] leading-4 text-emerald-700 dark:text-emerald-400">
                  <Check className="mt-0.5 size-3 shrink-0" />
                  Jarvis endpoint configured. The inbound webhook must also be
                  live, or messages still get no answer.
                </p>
              )}

              <TwilioSandboxHelp webhook={info.twilioWebhook} />
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            The number is managed by your WhatsApp provider.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
