// ---------------------------------------------------------------------------
// Slide viewer — read a .pptx without PowerPoint.
//
// Two ways in: a file from disk, or the deck this app just wrote (the studio
// builds the very bytes it would download and hands them over, so the preview
// is the file, not a second rendering of the spec).
//
// The reader is in `src/lib/pptx/read.ts`; this component only decides layout.
// Fidelity is deliberate: text in reading order, images, and the slide's real
// aspect ratio. Fonts, gradients and animations are the writer's business, and
// pretending otherwise would mean shipping a renderer this app does not have.
//
// Parsing and the object URLs both happen in the handlers that open a file, not
// in an effect: a viewer that re-renders itself twice on open is a viewer that
// flickers.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileUp, Loader2, Presentation, X } from "lucide-react";
import { disposeDeck, openDeck, type LoadedDeck, type SlideView } from "@/lib/pptx/read";

export interface SlideViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A deck read by the caller — the studio passes its own packaged bytes. */
  initial?: LoadedDeck | null;
  /** What to call the deck above the slide. */
  initialName?: string;
}

const NO_IMAGES: string[] = [];

function SlideFace({ slide, urls, ratio }: { slide: SlideView; urls: string[]; ratio: number }) {
  const body = slide.lines.filter((line) => line !== slide.title);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border border-border/70 bg-white text-black"
      style={{ aspectRatio: String(ratio) }}
    >
      <div className="flex h-full flex-col gap-2 overflow-auto p-5 sm:p-7">
        {slide.title ? (
          <p className="text-[clamp(0.95rem,2.1vw,1.6rem)] font-semibold leading-tight">
            {slide.title}
          </p>
        ) : null}
        {body.length > 0 ? (
          <ul className="space-y-1">
            {body.slice(0, 14).map((line, index) => (
              <li
                key={index}
                className="flex gap-2 text-[clamp(0.65rem,1.15vw,0.95rem)] leading-snug text-black/80"
              >
                <span className="mt-[0.45em] size-1 shrink-0 rounded-full bg-black/40" />
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {body.length > 14 ? (
          <p className="text-[10px] text-black/45">+{body.length - 14} more lines</p>
        ) : null}
        {urls.length > 0 ? (
          <div className="mt-auto flex items-end gap-2 overflow-hidden">
            {urls.slice(0, 4).map((url, index) => (
              <img
                key={url + index}
                src={url}
                alt=""
                className="max-h-[38%] max-w-[45%] object-contain"
              />
            ))}
          </div>
        ) : null}
        {slide.error ? <p className="mt-auto text-[11px] text-red-600">{slide.error}</p> : null}
      </div>
    </div>
  );
}

export function SlideViewer({ open, onOpenChange, initial, initialName }: SlideViewerProps) {
  // A file picked inside the viewer. The parent's deck is the fallback, so an
  // empty viewer re-opens on whatever was last read.
  const [picked, setPicked] = useState<{ loaded: LoadedDeck; name: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Kept in a ref as well, so closing can release URLs without depending on
  // the state value the closure captured.
  const pickedRef = useRef<{ loaded: LoadedDeck; name: string } | null>(null);

  const shown = picked ?? (initial ? { loaded: initial, name: initialName ?? "deck" } : null);
  const deck = shown?.loaded.deck ?? null;
  const slide = deck ? (deck.slides[Math.min(index, deck.slides.length - 1)] ?? null) : null;
  const ratio = deck ? deck.width / deck.height : 16 / 9;
  const slideIndex = deck && slide ? deck.slides.indexOf(slide) : 0;
  const urls = shown && slide ? (shown.loaded.images[slideIndex] ?? NO_IMAGES) : NO_IMAGES;

  const close = (next: boolean) => {
    if (!next) {
      if (pickedRef.current) disposeDeck(pickedRef.current.loaded);
      pickedRef.current = null;
      setPicked(null);
      setIndex(0);
    }
    onOpenChange(next);
  };

  useEffect(() => {
    if (!open || !deck) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        setIndex((at) => Math.min(deck.slides.length - 1, at + 1));
      } else if (event.key === "ArrowLeft") {
        setIndex((at) => Math.max(0, at - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, deck]);

  const readFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const loaded = await openDeck(new Uint8Array(buffer));
      if (pickedRef.current) disposeDeck(pickedRef.current.loaded);
      const entry = { loaded, name: file.name };
      pickedRef.current = entry;
      setPicked(entry);
      setIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto p-4 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Presentation className="size-4" />
            Slide viewer
          </DialogTitle>
          <DialogDescription className="pr-6 text-xs sm:text-sm">
            Open any .pptx and read it here — slide text, images and the real shape, without
            PowerPoint and without uploading it anywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".pptx"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <FileUp className="size-3.5" />
            Choose .pptx
          </Button>
          {deck ? (
            <>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {shown?.name} · {deck.slides.length} slides · {deck.width.toFixed(2)}×
                {deck.height.toFixed(2)} in
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex((at) => Math.max(0, at - 1))}
                  disabled={index === 0}
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <span className="w-14 text-center text-[11px] tabular-nums text-muted-foreground">
                  {Math.min(index, deck.slides.length - 1) + 1} / {deck.slides.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIndex((at) => Math.min(deck.slides.length - 1, at + 1))}
                  disabled={index >= deck.slides.length - 1}
                  aria-label="Next slide"
                >
                  <ChevronRight className="size-3.5" />
                </Button>
              </span>
            </>
          ) : null}
        </div>

        {busy ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the package…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <X className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : slide ? (
          <SlideFace key={slide.part} slide={slide} urls={urls} ratio={ratio} />
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
            <Presentation className="mx-auto size-5 text-muted-foreground/60" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing open yet — choose a .pptx, or press View in the studio.
            </p>
          </div>
        )}

        {deck && deck.slides.length > 1 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {deck.slides.map((entry, at) => (
              <button
                key={entry.part}
                type="button"
                onClick={() => setIndex(at)}
                title={entry.title || `Slide ${entry.number}`}
                className={
                  "flex h-12 w-20 shrink-0 flex-col justify-between rounded border px-1.5 py-1 text-left text-[9px] leading-tight transition-colors " +
                  (at === slideIndex
                    ? "border-primary/70 bg-accent text-foreground"
                    : "border-border/60 text-muted-foreground hover:border-foreground/30")
                }
              >
                <span className="truncate">{entry.title || `Slide ${entry.number}`}</span>
                <span className="tabular-nums opacity-60">{entry.number}</span>
              </button>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
