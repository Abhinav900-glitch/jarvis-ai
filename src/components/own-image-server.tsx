// ---------------------------------------------------------------------------
// Own image server — the setup form for a self-hosted image model.
//
// Sits inside Image Studio rather than a settings page because the endpoint is
// only meaningful next to the Generate button: you configure it, then you make
// a picture with it. The card stays collapsed to one line until opened, so the
// common path (using the hosted chain) is not pushed down the dialog.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Loader2, Plug, Server, Trash2, X } from "lucide-react";

export function OwnImageServer() {
  const config = useQuery(api.imageServer.get);
  const save = useMutation(api.imageServer.save);
  const test = useAction(api.imageServer.test);

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [model, setModel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // Saved values seed the form when it is opened, so reopening after a change
  // shows the stored endpoint instead of a blank box — and typing is never
  // interrupted by a server push.
  const openForm = () => {
    setUrl(config?.url ?? "");
    setModel(config?.model ?? "");
    setToken("");
    setResult(null);
    setOpen(true);
  };

  const host = config?.url
    ? config.url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
    : null;

  const handleSave = async () => {
    setBusy("save");
    setResult(null);
    try {
      await save({ url, model, token: token.trim() || undefined });
      setToken("");
      setResult({ ok: true, text: url.trim() ? "Saved." : "Removed." });
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : "Could not save.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    setResult(null);
    try {
      const report = await test({});
      setResult({ ok: report.ok, text: report.detail });
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : "Test failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    setBusy("remove");
    setResult(null);
    try {
      await save({ url: "" });
      setUrl("");
      setModel("");
      setToken("");
      setResult({ ok: true, text: "Removed — the hosted chain is used again." });
      setOpen(false);
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : "Could not remove.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openForm())}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Server className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Own image server</span>
        <span
          className={cn(
            "rounded px-1.5 py-px text-[10px] uppercase tracking-wide",
            config
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {config ? host : "not set"}
        </span>
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
          {config ? "Tried first" : "stable-diffusion.cpp · ComfyUI · A1111"}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-border/70 px-3 py-2.5">
          <div className="flex flex-wrap gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234"
              className="h-8 min-w-[14rem] flex-1 font-mono text-xs"
              aria-label="Image server URL"
            />
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="model (optional)"
              className="h-8 w-40 font-mono text-xs"
              aria-label="Model name"
            />
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder={
                config?.hasToken ? "token saved" : "token (optional)"
              }
              className="h-8 w-40 font-mono text-xs"
              aria-label="API token"
            />
            <Button
              onClick={() => void handleSave()}
              disabled={busy !== null}
              size="sm"
              className="h-8"
            >
              {busy === "save" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Save
            </Button>
            <Button
              onClick={() => void handleTest()}
              disabled={busy !== null || !config}
              size="sm"
              variant="outline"
              className="h-8"
              title={
                config
                  ? "Check that the app can reach this URL"
                  : "Save a URL first"
              }
            >
              {busy === "test" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plug className="size-3.5" />
              )}
              Test
            </Button>
            {config && (
              <Button
                onClick={() => void handleRemove()}
                disabled={busy !== null}
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground"
                title="Stop using this server"
              >
                {busy === "remove" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                Remove
              </Button>
            )}
          </div>

          {result && (
            <p
              className={cn(
                "flex items-start gap-1.5 text-[11px] leading-4",
                result.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              {result.ok ? (
                <Check className="mt-0.5 size-3 shrink-0" />
              ) : (
                <X className="mt-0.5 size-3 shrink-0" />
              )}
              <span className="break-words">{result.text}</span>
            </p>
          )}

          <p className="text-[11px] leading-4 text-muted-foreground">
            Calls run server-side, so the URL must be reachable from the
            internet — a local port needs a tunnel (<code>cloudflared</code>,{" "}
            <code>ngrok</code>). <code>sd-server</code> listens on port 1234 by
            default. Both <code>/v1/images/generations</code> and{" "}
            <code>/sdapi/v1/txt2img</code> are tried. The token stays on the
            server and never reaches the browser.
          </p>
        </div>
      )}
    </div>
  );
}
