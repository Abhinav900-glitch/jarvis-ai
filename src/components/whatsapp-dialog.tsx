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

import { useAction } from "convex/react";
import { Check, Copy, Loader2, MessageCircle, Phone } from "lucide-react";
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
  envName: string;
}

export interface WhatsAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsAppDialog({ open, onOpenChange }: WhatsAppDialogProps) {
  const getWhatsapp = useAction(api.manychat.whatsapp);
  const [info, setInfo] = useState<WhatsappInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setInfo(null);
      setError(null);
      setCopied(false);
      void getWhatsapp({})
        .then((result) => {
          if (!cancelled) setInfo(result as WhatsappInfo);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(
              err instanceof Error
                ? err.message
                : "Could not load the WhatsApp number.",
            );
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, getWhatsapp]);

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
          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[11px] text-destructive">
              {error}
            </p>
          ) : info === null ? (
            <span className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading the assistant's number…
            </span>
          ) : !info.display || !info.number || !info.link ? (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-[11px] leading-5">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                No WhatsApp number is connected yet.
              </p>
              <p className="text-muted-foreground">
                In ManyChat, open Settings → WhatsApp → Connect and use a number
                you own, or let ManyChat issue one. Copy that number and save it
                as{" "}
                <span className="font-mono text-foreground">
                  {info.envName}
                </span>{" "}
                in the Keys tab — digits with the country code, for example{" "}
                <span className="font-mono text-foreground">14155550123</span>.
              </p>
              <p className="text-muted-foreground/80">
                WhatsApp numbers are issued by Meta or the provider that connects
                to it. An app cannot mint a real number at runtime; this screen
                publishes the number ManyChat connected.
              </p>
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
                  ManyChat forwards it to Jarvis, and the reply lands back in the
                  same chat. Recent messages are remembered per contact.
                </li>
              </ol>

              {!info.channelReady ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-5 text-amber-800 dark:text-amber-300">
                  The number is set, but the reply path is not: add{" "}
                  <span className="font-mono">MANYCHAT_WEBHOOK_SECRET</span> or a
                  ManyChat key in the Keys tab, and point the ManyChat External
                  Request at the endpoint in the ManyChat panel.
                </p>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                  <Check className="size-3" />
                  Reply path configured
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            The number itself is managed in ManyChat.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
