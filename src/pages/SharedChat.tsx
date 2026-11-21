// ---------------------------------------------------------------------------
// /c/:slug — one shared conversation, readable without an account.
//
// The snapshot is stored in Convex and the page reads it with a public query.
// A revoked link is indistinguishable from one that never existed, so nothing
// here says "deleted" — only that the link opens nothing.
// ---------------------------------------------------------------------------

import { Link, useParams } from "react-router";
import { useQuery } from "convex/react";
import { ArrowUpRight, Loader2, MessageSquare, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { JarvisMark } from "@/components/jarvis-logo";
import { MarkdownMessage } from "@/components/markdown-message";

export default function SharedChat() {
  const { slug } = useParams<{ slug: string }>();
  const share = useQuery(api.chatShares.get, { slug: slug ?? "" });

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
            Ask your own
            <ArrowUpRight className="size-3.5" />
          </Button>
        </Link>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 sm:px-6">
        {share === undefined && (
          <div className="mt-24 flex flex-col items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Loading
            </p>
          </div>
        )}

        {share === null && (
          <div className="hud-panel hud-corners mt-16 w-full max-w-md rounded-2xl px-6 py-10 text-center">
            <p className="hud-label">Signal lost</p>
            <h1 className="mt-3 text-lg font-semibold">
              This link doesn't open anything
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              It may have been revoked by whoever shared it, or it never
              existed.
            </p>
            <Link to="/" className="mt-6 inline-block">
              <Button size="sm">Start a conversation</Button>
            </Link>
          </div>
        )}

        {share && (
          <article className="mt-6 w-full max-w-3xl">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="hud-label hud-label-cyan">Shared conversation</p>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {share.title || "Untitled chat"}
                </h1>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(share.createdAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}{" "}
                  · {share.messages.length} message
                  {share.messages.length === 1 ? "" : "s"} · read-only snapshot
                </p>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[10px] text-muted-foreground">
                <ShieldCheck className="size-3" />
                Shared by the author
              </span>
            </div>

            <div className="hud-panel hud-corners space-y-6 rounded-2xl px-4 py-6 sm:px-6">
              {share.messages.map((message, index) =>
                message.role === "user" ? (
                  <div
                    key={`${message.createdAt}-${index}`}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border/70 bg-accent/60 px-4 py-2.5 text-sm leading-6">
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                      {message.imageUrl ? (
                        <img
                          src={message.imageUrl}
                          alt="Attachment"
                          className="mt-2 max-h-64 rounded-lg border border-border/60 object-contain"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div
                    key={`${message.createdAt}-${index}`}
                    className="text-sm leading-7"
                  >
                    {message.content ? (
                      <MarkdownMessage content={message.content} />
                    ) : null}
                    {message.imageUrl ? (
                      <img
                        src={message.imageUrl}
                        alt="Generated"
                        className="mt-3 max-h-80 rounded-lg border border-border/60 object-contain"
                      />
                    ) : null}
                  </div>
                ),
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">
                The link works until the owner stops sharing it. It never grows
                later messages.
              </p>
              <Link to="/">
                <Button size="sm" variant="outline">
                  <MessageSquare className="size-3.5" />
                  Continue with your own
                </Button>
              </Link>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}
