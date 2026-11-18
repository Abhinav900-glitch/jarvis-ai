// ---------------------------------------------------------------------------
// /gallery — every studio picture this account has stored in Supabase.
//
// The Image Studio keeps twelve pictures in the browser so a closed tab is not
// a lost render. This page is the other half of that promise: the whole
// archive, in date order, searchable, readable from any device.
//
// It reads through a Convex action rather than from Postgres directly, so no
// Supabase key is in the bundle and the table can stay closed to the anon key.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useAction } from "convex/react";
import {
  ArrowLeft,
  Image as ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Lightbox } from "@/components/lightbox";
import { JarvisMark } from "@/components/jarvis-logo";
import { downloadImage, imageFileName } from "@/lib/download-image";

/** One stored picture, matching the shape `supabase.list` returns. */
interface GalleryRow {
  url: string;
  prompt: string;
  kind: string;
  provider?: string;
  aspect?: string;
  score?: number;
  refined: boolean;
  pinned: boolean;
  reference?: string;
  pageTitle?: string;
  shareSlug?: string;
  createdAt: number;
}

type GalleryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: GalleryRow[]; message: string | null };

export default function Gallery() {
  const load = useAction(api.supabase.list);
  const [state, setState] = useState<GalleryState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<number | null>(null);
  // Bumped to re-run the read, so the refresh button is one state change
  // rather than a second copy of the loader.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const result = await load({});
        if (!live) return;
        setState(
          result.message
            ? { status: "error", message: result.message }
            : { status: "ready", rows: result.entries, message: null },
        );
      } catch (err) {
        if (!live) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Couldn't read the gallery.",
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [load, reloadKey]);

  const rows = state.status === "ready" ? state.rows : [];

  /** Prompt, provider and reference page are all things a person remembers. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.prompt, row.provider, row.pageTitle]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [query, rows]);

  const sharedCount = rows.filter((row) => row.shareSlug).length;

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

      <header className="px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard"
              className="flex size-8 items-center justify-center rounded-md border border-border/70 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              title="Back to Jarvis"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <div>
              <p className="hud-label hud-label-cyan">Studio archive</p>
              <h1 className="text-lg font-semibold tracking-tight">Gallery</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prompts"
                autoComplete="off"
                spellCheck={false}
                // 16px on phones, for the same reason the studio's prompt box
                // is: anything smaller makes iOS zoom the page on focus.
                className="w-44 rounded-md border border-border/70 bg-background py-1.5 pr-2 pl-8 text-base outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30 sm:w-60 sm:text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={state.status === "loading"}
              title="Read the archive again"
            >
              {state.status === "loading" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 pb-16 sm:px-6">
        <div className="w-full max-w-6xl">
          {state.status === "loading" && (
            <div className="mt-24 flex flex-col items-center gap-3">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                Reading the archive
              </p>
            </div>
          )}

          {state.status === "error" && (
            <div className="hud-panel hud-corners mx-auto mt-16 max-w-md rounded-2xl px-6 py-10 text-center">
              <ImageIcon className="mx-auto size-5 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold">
                The archive can't be read right now
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {state.message}
              </p>
              <Link to="/dashboard" className="mt-6 inline-block">
                <Button size="sm">Back to the studio</Button>
              </Link>
            </div>
          )}

          {state.status === "ready" && rows.length === 0 && (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <ImageIcon className="mx-auto size-5 text-muted-foreground/60" />
              <h2 className="mt-3 text-base font-semibold">Nothing backed up yet</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Open the Image Studio and press <span className="text-foreground">Back up</span>{" "}
                under Cloud copy — every picture there then appears here, on any device.
              </p>
              <Link to="/dashboard" className="mt-6 inline-block">
                <Button size="sm">Open the studio</Button>
              </Link>
            </div>
          )}

          {state.status === "ready" && rows.length > 0 && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>
                  {shown.length === rows.length
                    ? `${rows.length} picture${rows.length === 1 ? "" : "s"}`
                    : `${shown.length} of ${rows.length} pictures`}
                </span>
                {sharedCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3" />
                    {sharedCount} with a public link
                  </span>
                )}
                <span className="ml-auto hidden sm:inline">
                  Stored in Supabase — newest first
                </span>
              </div>

              {shown.length === 0 ? (
                <p className="mt-10 text-center text-sm text-muted-foreground">
                  Nothing matches “{query.trim()}”.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {shown.map((row, index) => (
                    <button
                      key={row.url}
                      type="button"
                      onClick={() => setPreview(index)}
                      title={row.prompt}
                      className="group relative overflow-hidden rounded-lg border border-border/70 text-left transition-colors hover:border-foreground/30"
                    >
                      <img
                        src={row.url}
                        alt={row.prompt}
                        loading="lazy"
                        className="aspect-square w-full bg-black/20 object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pt-6 pb-2">
                        <p className="line-clamp-2 text-[11px] leading-4 text-white/90">
                          {row.prompt || "Untitled"}
                        </p>
                      </div>
                      <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                        <span className="rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium tracking-wide text-white uppercase">
                          {row.kind === "web" ? "web" : row.refined ? "refined" : "ai"}
                        </span>
                        {row.shareSlug && (
                          <span
                            className="rounded bg-black/60 p-0.5 text-white"
                            title="Has a public link"
                          >
                            <Link2 className="size-2.5" />
                          </span>
                        )}
                      </div>
                      {typeof row.score === "number" && (
                        <span
                          className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold tabular-nums text-white"
                          title="Review score against the prompt"
                        >
                          {row.score}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-border/70 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center gap-2 text-[11px] text-muted-foreground">
          <JarvisMark className="size-4" />
          Read from Supabase through the deployment — no database key reaches this page.
        </div>
      </footer>

      {preview !== null && shown[preview] && (
        <Lightbox
          images={shown.map((row) => row.url)}
          startIndex={preview}
          alt={shown[preview].prompt}
          onClose={() => setPreview(null)}
          onDownload={(url) => {
            const row = shown.find((candidate) => candidate.url === url);
            void downloadImage(url, imageFileName(url, row?.prompt));
          }}
        />
      )}
    </div>
  );
}
