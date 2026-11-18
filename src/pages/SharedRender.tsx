// ---------------------------------------------------------------------------
// /s/:slug — one shared picture, readable without an account.
//
// The row lives in Supabase, but this page never talks to it: it asks a Convex
// action for the one picture behind the slug, and that action holds the secret
// key and returns public fields only. So a share link works for a stranger
// while the table itself stays closed to the browser.
//
// A revoked link is indistinguishable from one that never existed. That is
// deliberate: "this was deleted" still confirms the picture was there.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useAction } from "convex/react";
import { ArrowUpRight, Check, Copy, Download, Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { JarvisMark } from "@/components/jarvis-logo";
import { downloadImage, imageFileName } from "@/lib/download-image";

interface SharedPicture {
  url: string;
  prompt: string;
  provider?: string;
  pageTitle?: string;
  score?: number;
  createdAt: number | null;
}

type PageState =
  | { status: "loading" }
  | { status: "missing"; message: string | null }
  | { status: "ready"; render: SharedPicture };

export default function SharedRender() {
  const { slug } = useParams<{ slug: string }>();
  const load = useAction(api.supabase.shared);
  const [state, setState] = useState<PageState>({ status: "loading" });
  // Copying the prompt is the second thing anyone does with a share link: the
  // picture is finished, the words that made it are the reusable part.
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const result = await load({ slug: slug ?? "" });
        if (!live) return;
        setState(
          result.render
            ? { status: "ready", render: result.render as SharedPicture }
            : { status: "missing", message: result.message },
        );
      } catch (err) {
        if (!live) return;
        setState({
          status: "missing",
          message:
            err instanceof Error ? err.message : "Couldn't load this picture.",
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [slug, load]);

  return (
    <div className="hud-grid-bg flex min-h-screen flex-col bg-background text-foreground">
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), var(--signal-violet), transparent)",
        }}
      />

      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <JarvisMark className="size-6" />
          <span className="text-sm font-medium tracking-tight">Jarvis</span>
        </Link>
        <Link to="/">
          <Button variant="outline" size="sm">
            Make your own
            <ArrowUpRight className="size-3.5" />
          </Button>
        </Link>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 sm:px-6">
        {state.status === "loading" && (
          <div className="mt-24 flex flex-col items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Loading
            </p>
          </div>
        )}

        {state.status === "missing" && (
          <div className="hud-panel hud-corners mt-16 w-full max-w-md rounded-2xl px-6 py-10 text-center">
            <p className="hud-label">Signal lost</p>
            <h1 className="mt-3 text-lg font-semibold">This link doesn't open anything</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {state.message ??
                "It may have been revoked by whoever shared it, or it never existed."}
            </p>
            <Link to="/" className="mt-6 inline-block">
              <Button size="sm">Create your own picture</Button>
            </Link>
          </div>
        )}

        {state.status === "ready" && (
          <article className="mt-6 w-full max-w-3xl">
            <div className="hud-panel hud-corners overflow-hidden rounded-2xl">
              <img
                src={state.render.url}
                alt={state.render.prompt || "Shared picture"}
                className="max-h-[68vh] w-full bg-black/20 object-contain"
              />
              <div className="border-t border-border/70 px-4 py-3 sm:px-5">
                {state.render.prompt && (
                  <p className="text-sm leading-6 text-foreground">
                    {state.render.prompt}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {state.render.provider && (
                    <span className="rounded-full border border-border/70 px-2 py-0.5 uppercase tracking-wide">
                      {state.render.provider}
                    </span>
                  )}
                  {typeof state.render.score === "number" && (
                    <span>Scored {state.render.score}/100 against the prompt</span>
                  )}
                  {state.render.pageTitle && (
                    <span className="truncate">Reference: {state.render.pageTitle}</span>
                  )}
                  {state.render.createdAt !== null && (
                    <span>
                      {new Date(state.render.createdAt).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 bg-background px-4 py-2 sm:px-5">
                <span className="text-[11px] text-muted-foreground">
                  Shared from Jarvis Image Studio
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {state.render.prompt ? (
                    <button
                      type="button"
                      onClick={() => {
                        const prompt = state.render.prompt;
                        void navigator.clipboard
                          .writeText(prompt)
                          .then(() => {
                            setCopiedPrompt(true);
                            window.setTimeout(() => setCopiedPrompt(false), 1600);
                          })
                          .catch(() => {});
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-foreground/30"
                    >
                      {copiedPrompt ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                      {copiedPrompt ? "Copied" : "Copy prompt"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const url = state.render.url;
                      void downloadImage(url, imageFileName(url, state.render.prompt));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-foreground transition-colors hover:border-foreground/30"
                  >
                    <Download className="size-3.5" />
                    Download
                  </button>
                  <a
                    href={state.render.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    Open full size
                    <ArrowUpRight className="size-3.5" />
                  </a>
                </div>
              </div>
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              The link works until the owner stops sharing it.
            </p>
          </article>
        )}
      </main>
    </div>
  );
}
