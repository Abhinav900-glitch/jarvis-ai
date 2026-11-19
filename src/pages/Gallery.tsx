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

import { useEffect, useMemo, useRef, useState } from "react";
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
import { nextTileIndex } from "@/lib/gallery-nav";
import { cn } from "@/lib/utils";

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
  // What kind of picture to show. "shared" is a state rather than a kind, but
  // it is the other question people ask of an archive: what can I send?
  const [filter, setFilter] = useState<"all" | "ai" | "web" | "shared">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "best">("newest");
  const [preview, setPreview] = useState<number | null>(null);
  // Keyboard navigation needs the grid to know its own shape: Up and Down move
  // by a row, and a row is however many columns the current breakpoint drew.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Where the viewer left off, so closing it returns the keyboard there rather
  // than to the picture that happened to be clicked first.
  const lastViewed = useRef(0);
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
    const matching = rows.filter((row) => {
      if (filter === "ai" && row.kind !== "ai") return false;
      if (filter === "web" && row.kind !== "web") return false;
      if (filter === "shared" && !row.shareSlug) return false;
      if (!needle) return true;
      return [row.prompt, row.provider, row.pageTitle]
        .filter((value): value is string => typeof value === "string")
        .some((value) => value.toLowerCase().includes(needle));
    });
    if (sort === "oldest") return [...matching].sort((a, b) => a.createdAt - b.createdAt);
    if (sort === "best") {
      // Unscored pictures last: a missing score is not a zero, and burying
      // older renders below a "0" would be a lie about them.
      return [...matching].sort(
        (a, b) => (b.score ?? -1) - (a.score ?? -1),
      );
    }
    return matching;
  }, [filter, query, rows, sort]);

  const sharedCount = rows.filter((row) => row.shareSlug).length;

  /** Columns in the rendered grid — 2 on a phone, up to 4 on a desktop. */
  const gridColumns = () => {
    const grid = gridRef.current;
    if (!grid) return 1;
    const template = getComputedStyle(grid).gridTemplateColumns;
    return Math.max(1, template.split(" ").filter(Boolean).length);
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const from = tileRefs.current.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    const next = nextTileIndex(from, event.key, gridColumns(), shown.length);
    if (next === null) return;
    // The grid owns the arrows, so preventDefault before moving: otherwise the
    // page scrolls at the same time as the focus ring.
    event.preventDefault();
    const tile = tileRefs.current[next];
    tile?.focus();
    tile?.scrollIntoView({ block: "nearest" });
  };

  /** Closing the viewer puts the keyboard back on the picture last seen. */
  const closePreview = () => {
    if (preview === null) return;
    const index = Math.min(lastViewed.current, Math.max(0, shown.length - 1));
    setPreview(null);
    requestAnimationFrame(() => tileRefs.current[index]?.focus());
  };

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
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {(
                  [
                    ["all", "All", rows.length],
                    ["ai", "AI", rows.filter((row) => row.kind === "ai").length],
                    ["web", "Web", rows.filter((row) => row.kind === "web").length],
                    ["shared", "Shared", sharedCount],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                      filter === value
                        ? "border-foreground/30 bg-accent text-foreground"
                        : "border-border/70 text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {label}
                    <span className="ml-1 tabular-nums opacity-60">{count}</span>
                  </button>
                ))}
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  Sort
                  <select
                    value={sort}
                    onChange={(e) =>
                      setSort(e.target.value as "newest" | "oldest" | "best")
                    }
                    className="rounded-md border border-border/70 bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus:border-foreground/30"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="best">Best score</option>
                  </select>
                </label>
              </div>

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
                  Stored in Supabase · ← → to move
                </span>
              </div>

              {shown.length === 0 ? (
                <div className="mt-10 text-center text-sm text-muted-foreground">
                  <p>
                    {query.trim()
                      ? `Nothing matches “${query.trim()}”.`
                      : "Nothing in this filter yet."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                    className="mt-2 text-xs text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    Show everything
                  </button>
                </div>
              ) : (
                <div
                  ref={gridRef}
                  onKeyDown={onGridKeyDown}
                  className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                >
                  {shown.map((row, index) => (
                    <button
                      key={row.url}
                      type="button"
                      ref={(element) => {
                        tileRefs.current[index] = element;
                      }}
                      onClick={() => {
                        lastViewed.current = index;
                        setPreview(index);
                      }}
                      title={row.prompt}
                      aria-label={`Open picture ${index + 1} of ${shown.length}: ${row.prompt || "Untitled"}`}
                      className="group relative overflow-hidden rounded-lg border border-border/70 text-left transition-colors outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-[color:var(--signal-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
          alts={shown.map((row) => row.prompt)}
          onIndexChange={(index) => {
            lastViewed.current = index;
          }}
          onClose={closePreview}
          onDownload={(url) => {
            const row = shown.find((candidate) => candidate.url === url);
            void downloadImage(url, imageFileName(url, row?.prompt));
          }}
        />
      )}
    </div>
  );
}
