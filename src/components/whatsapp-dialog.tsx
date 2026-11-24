// ---------------------------------------------------------------------------
// WhatsApp mode.
//
// The assistant has a phone number of its own: someone saves it, messages it
// from WhatsApp, and the reply arrives in the same chat. The dashboard is only
// a hand-off screen — the conversation itself never happens here, which is the
// point. Sent, ManyChat or Twilio owns the WhatsApp Business connection; this
// deployment owns the brain behind it.
//
// The number is configuration because WhatsApp issues numbers through Meta (or
// a provider connected to Meta), not through application code. When it is not
// set the dialog says exactly what is missing instead of showing a fake number.
// ---------------------------------------------------------------------------

import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  sentKeyPresent: boolean;
  sentReady: boolean;
  envName: string;
}

interface SentStatus {
  keyPresent: boolean;
  accountType: string | null;
  whatsappConfigured: boolean;
  smsConfigured: boolean;
  rcsConfigured: boolean;
  sendingNumber: string | null;
  businessName: string | null;
  profileCount: number;
  profileId: string | null;
  webhookUrlReady: boolean;
  signedWebhook: boolean;
  error: string | null;
}

/** The copyable URL never stays in React state; only its base is shown. */
interface SentWebhookResult {
  base: string | null;
  signed: boolean;
  error: string | null;
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

/**
 * Sent (sent.dm) status and setup.
 *
 * A Sent API key is not a WhatsApp channel: KYC, a sender number and a Meta
 * Business connection are configured in Sent's dashboard. This card reports
 * which piece is missing, hands over the app's webhook URL, and connects the
 * Sent number once WhatsApp is actually ready.
 */
function SentWhatsAppHelp({
  status,
  loading,
  saving,
  connectedNumber,
  onRefresh,
  onUseNumber,
}: {
  status: SentStatus | null;
  loading: boolean;
  saving: boolean;
  connectedNumber: string | null;
  onRefresh: () => void;
  onUseNumber: (number: string) => void;
}) {
  const getWebhookUrl = useAction(api.sent.webhookUrl);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webhook, setWebhook] = useState<SentWebhookResult | null>(null);

  const number = status?.sendingNumber?.trim() ?? "";
  const digits = number.replace(/\D/g, "");
  const connected = Boolean(digits && connectedNumber === digits);
  const ready = status?.whatsappConfigured === true && Boolean(digits);

  const badge = !status
    ? "Checking…"
    : status.error
      ? "Check Sent"
      : ready
        ? "WhatsApp ready"
        : status.keyPresent
          ? "Setup needed"
          : "No key";

  const copyWebhook = async () => {
    setCopying(true);
    try {
      const result = await getWebhookUrl();
      setWebhook({
        base: result.url ? result.url.split("?")[0] : null,
        signed: result.signed,
        error: result.error,
      });
      if (!result.url) {
        toast.error(result.error ?? "Could not build the Sent webhook URL.");
        return;
      }
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      toast.success(
        result.signed
          ? "Sent webhook URL copied. Deliveries are signature-checked."
          : "Sent webhook URL copied with a fallback key.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not copy the webhook URL.",
      );
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-foreground">
            Sent (sent.dm)
            <span className="rounded-full border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">
              {badge}
            </span>
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            A dedicated WhatsApp Business number, answered by Jarvis through
            Sent.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh Sent status"
          aria-label="Refresh Sent status"
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </button>
      </div>

      {status?.error ? (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
          {status.error}
        </p>
      ) : null}

      {ready ? (
        <div className="mt-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Sent WhatsApp number
          </p>
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-sm font-semibold text-foreground">
                {number}
              </p>
              {status.businessName ? (
                <p className="truncate text-[9px] text-muted-foreground">
                  {status.businessName}
                </p>
              ) : null}
            </div>
            {connected ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                <Check className="size-3" /> Connected
              </span>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-[10px]"
                disabled={saving}
                onClick={() => onUseNumber(number)}
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : null}
                Use this number
              </Button>
            )}
          </div>
        </div>
      ) : status?.keyPresent && !status.error ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-medium text-foreground">
            Finish Sent&apos;s WhatsApp setup
          </summary>
          <ol className="mt-1.5 space-y-1 text-[10px] leading-4 text-muted-foreground">
            <li>
              1. In Sent, complete KYC, choose a number and connect a verified
              Meta Business account / WhatsApp Business account.
            </li>
            <li>
              2. Create a webhook and subscribe to{" "}
              <span className="text-foreground">Message → Received</span>.
            </li>
            <li>
              3. Paste the URL from this card. Optionally add the webhook
              signing secret as{" "}
              <span className="font-mono text-foreground">
                SENT_WEBHOOK_SECRET
              </span>{" "}
              in the Keys tab for signed deliveries.
            </li>
            <li>
              4. Refresh here; when WhatsApp shows ready, connect the Sent
              number.
            </li>
          </ol>
          <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground/80">
            Sent requires KYC approval, a verified Meta Business account and
            billing. For a free test, use the Twilio Sandbox below.
          </p>
        </details>
      ) : null}

      {status && status.profileCount > 0 && !status.profileId ? (
        <p className="mt-2 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
          This organization key sees {status.profileCount} sender profile
          {status.profileCount === 1 ? "" : "s"}. If sends fail, set{" "}
          <span className="font-mono">SENT_PROFILE_ID</span> to the profile
          UUID; only organization keys accept that header.
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-[10px]"
          disabled={copying}
          onClick={() => void copyWebhook()}
        >
          {copying ? (
            <Loader2 className="size-3 animate-spin" />
          ) : copied ? (
            <Check className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? "Webhook URL copied" : "Copy Sent webhook URL"}
        </Button>
        <a
          href="https://app.sent.dm/dashboard"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] underline decoration-border underline-offset-2 hover:text-foreground"
        >
          Open Sent <ExternalLink className="size-2.5" />
        </a>
      </div>

      {webhook?.base ? (
        <span className="mt-1.5 block break-all rounded bg-muted/60 px-1.5 py-1 font-mono text-[9px] text-foreground">
          {webhook.base}
        </span>
      ) : null}
      {webhook?.error ? (
        <p className="mt-1.5 text-[10px] leading-4 text-amber-800 dark:text-amber-300">
          {webhook.error}
        </p>
      ) : null}
      {ready ? (
        <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground/80">
          In Sent: Webhooks → Add Webhook → paste the URL → subscribe to{" "}
          <span className="text-foreground">Message → Received</span>.
        </p>
      ) : null}
      {webhook ? (
        <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground/80">
          {webhook.signed
            ? "SENT_WEBHOOK_SECRET is set, so Sent signs each delivery."
            : "The copied URL includes a fallback key derived from SENT_API_KEY. Add SENT_WEBHOOK_SECRET later for signed deliveries."}
        </p>
      ) : null}
    </div>
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
  const getSentStatus = useAction(api.sent.status);
  const [sent, setSent] = useState<SentStatus | null>(null);
  const [sentLoading, setSentLoading] = useState(false);

  // The Sent account is an external API, so it is read when the dialog opens
  // and on demand instead of subscribing the browser to it.
  const loadSent = useCallback(async () => {
    setSentLoading(true);
    try {
      setSent((await getSentStatus()) as SentStatus);
    } catch (err) {
      setSent({
        keyPresent: false,
        accountType: null,
        whatsappConfigured: false,
        smsConfigured: false,
        rcsConfigured: false,
        sendingNumber: null,
        businessName: null,
        profileCount: 0,
        profileId: null,
        webhookUrlReady: false,
        signedWebhook: false,
        error: err instanceof Error ? err.message : "Could not check Sent.",
      });
    } finally {
      setSentLoading(false);
    }
  }, [getSentStatus]);

  useEffect(() => {
    if (open) void loadSent();
  }, [open, loadSent]);

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
                Use the number connected to Sent, ManyChat, or a Twilio WhatsApp
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
              <SentWhatsAppHelp
                status={sent}
                loading={sentLoading}
                saving={saving}
                connectedNumber={info.number}
                onRefresh={() => void loadSent()}
                onUseNumber={(value) => void connectNumber(value)}
              />
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

              <SentWhatsAppHelp
                status={sent}
                loading={sentLoading}
                saving={saving}
                connectedNumber={info.number}
                onRefresh={() => void loadSent()}
                onUseNumber={(value) => void connectNumber(value)}
              />

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

              {!info.channelReady && !info.sentReady ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                  The number is set, but the reply path is not: add{" "}
                  <span className="font-mono">SENT_API_KEY</span> for Sent, or{" "}
                  <span className="font-mono">TWILIO_WEBHOOK_SECRET</span> /{" "}
                  <span className="font-mono">MANYCHAT_WEBHOOK_SECRET</span> for
                  the other providers, then point the inbound webhook at the
                  Jarvis endpoint.
                </p>
              ) : (
                <p className="inline-flex items-start gap-1.5 text-[10px] leading-4 text-emerald-700 dark:text-emerald-400">
                  <Check className="mt-0.5 size-3 shrink-0" />
                  Reply endpoint configured. The provider&apos;s inbound webhook
                  must also be live, or messages still get no answer.
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
