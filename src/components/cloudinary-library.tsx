// ---------------------------------------------------------------------------
// Cloudinary library — the account's own media, browsable from the studio.
//
// Everything Jarvis generates or uploads is stored in Cloudinary, and the
// account can also hold pictures from elsewhere. The studio used to start a
// variation only from a fresh upload or its own recent renders, so those
// pre-existing assets were unreachable. This dialog lists them with the Admin
// Search API and hands one back as the variation source.
//
// A plain overlay rather than a Radix Dialog: the studio is already a Dialog,
// and a nested one would trap focus twice and dismiss the studio behind it.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, FolderOpen, Loader2, Search, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface CloudinaryAsset {
  publicId: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
  format: string | null;
  bytes: number | null;
  createdAt: string | null;
}

export interface CloudinaryLibraryProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen picture; the studio turns it into a variation. */
  onUse: (asset: CloudinaryAsset) => void;
}

const PAGE_SIZE = 24;

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CloudinaryLibrary({
  open,
  onClose,
  onUse,
}: CloudinaryLibraryProps) {
  const listMedia = useAction(api.cloudinary.listMedia);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CloudinaryAsset[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // A slow first page must not overwrite a newer search's results.
  const requestRef = useRef(0);

  const load = useCallback(
    async (search: string, after: string | null) => {
      const token = requestRef.current + 1;
      requestRef.current = token;
      setBusy(true);
      setError(null);
      try {
        const page = await listMedia({
          query: search.trim() || undefined,
          cursor: after ?? undefined,
          limit: PAGE_SIZE,
        });
        if (token !== requestRef.current) return;
        setItems((previous) => (after ? [...previous, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setTotal(page.total);
      } catch (err) {
        if (token !== requestRef.current) return;
        setError(
          err instanceof Error ? err.message : "Could not read the library.",
        );
      } finally {
        if (token === requestRef.current) setBusy(false);
      }
    },
    [listMedia],
  );

  // Reset the search on the open transition (rendering adjusts state, an
  // effect would render once with last visit's filter), then load the newest
  // page. Same pattern the studio uses for its own open transition.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery("");
  }

  /* eslint-disable react-hooks/set-state-in-effect -- async load, unavoidable */
  useEffect(() => {
    if (!open) return;
    void load("", null);
  }, [open, load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    void load(query, null);
  };

  const copy = async (asset: CloudinaryAsset) => {
    try {
      await navigator.clipboard.writeText(asset.url);
      setCopied(asset.url);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error(asset.url);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-start justify-center bg-background/70 p-0 backdrop-blur-sm sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.16 }}
            onClick={(event) => event.stopPropagation()}
            className="flex h-full max-h-none w-full flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[86vh] sm:max-w-3xl sm:rounded-2xl sm:border"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
              <FolderOpen className="size-4 text-primary" />
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Cloudinary library</h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  {total > 0
                    ? `${total.toLocaleString()} picture${total === 1 ? "" : "s"} in this account`
                    : "Your account's own media, newest first"}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                title="Close"
                className="ml-auto rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form
              onSubmit={submit}
              className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-4 py-2"
            >
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search public IDs and names, e.g. jarvis-gen"
                className="h-8 text-[11px]"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-[11px]"
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Search
              </Button>
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
                  {error}
                  <p className="mt-1 text-muted-foreground">
                    The library reads with CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY
                    and CLOUDINARY_API_SECRET — check those in the Keys tab.
                  </p>
                </div>
              ) : items.length === 0 && busy ? (
                <div className="flex items-center justify-center py-16 text-[11px] text-muted-foreground">
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Reading the library…
                </div>
              ) : items.length === 0 ? (
                <div className="py-16 text-center text-[11px] text-muted-foreground">
                  Nothing matches that. Try a different public ID or name.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {items.map((asset) => (
                    <div
                      key={asset.url}
                      className="group relative overflow-hidden rounded-lg border border-border/60 bg-muted/30"
                    >
                      <button
                        type="button"
                        onClick={() => onUse(asset)}
                        title={`${asset.name} — use as the variation source`}
                        className="block w-full text-left"
                      >
                        <img
                          src={asset.url}
                          alt={asset.name}
                          loading="lazy"
                          className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 py-1.5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                          <Shuffle className="size-3" />
                          Use as reference
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void copy(asset)}
                        title="Copy the delivery URL"
                        className={cn(
                          "absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 text-white opacity-0 transition-opacity hover:bg-black/75 group-hover:opacity-100",
                          copied === asset.url && "opacity-100",
                        )}
                      >
                        {copied === asset.url ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                      <div className="flex items-center justify-between gap-1 px-2 py-1 text-[9px] text-muted-foreground">
                        <span className="truncate">{asset.format ?? "image"}</span>
                        <span className="shrink-0">
                          {asset.width && asset.height
                            ? `${asset.width}×${asset.height}`
                            : sizeLabel(asset.bytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 px-4 py-2">
              <p className="text-[10px] text-muted-foreground/70">
                {items.length > 0
                  ? `Showing ${items.length} of ${total.toLocaleString()}`
                  : "Newest first"}
              </p>
              {cursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[10px]"
                  disabled={busy}
                  onClick={() => void load(query, cursor)}
                >
                  {busy ? <Loader2 className="size-3 animate-spin" /> : null}
                  Load more
                </Button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
