// ---------------------------------------------------------------------------
// File viewer — .pptx, .xlsx, .docx, .csv. Opened inside Jarvis: no upload, no
// converter, no network. The readers are in `src/lib/office/read.ts` and
// `src/lib/pptx/read.ts`; this component only decides layout.
//
// Fidelity is deliberate. Slides show text in reading order, images and the
// real aspect ratio; sheets show a grid with real column positions; documents
// show paragraphs and tables in document order. Fonts, colours, charts, merged
// cells and animations are not reproduced, and pretending otherwise would mean
// shipping an Office renderer this app does not have.
//
// Parsing happens in the handler that opens a file, never in an effect: a
// viewer that re-renders itself twice on open is a viewer that flickers, and
// the slide branch creates blob URLs that need an owner.
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
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FileUp,
  Loader2,
  Presentation,
  X,
} from "lucide-react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  conversionTargets,
  extensionOf,
  mimeForTarget,
} from "@/lib/convert-formats";
import { disposeOpenedFile, openOfficeFile, type OpenedFile, type SheetTable } from "@/lib/office/read";
import type { SlideView } from "@/lib/pptx/read";

export interface FileViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A file the caller already read — the studio passes its own packaged deck. */
  initial?: OpenedFile | null;
  /**
   * The bytes behind `initial`, so the viewer can convert without asking the
   * caller to upload anything: the file already exists in memory, and only a
   * conversion needs the service.
   */
  initialSource?: { name: string; bytes: Uint8Array } | null;
}

const ACCEPT = ".pptx,.xlsx,.xlsm,.docx,.csv,.tsv";

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
              <img key={url + index} src={url} alt="" className="max-h-[38%] max-w-[45%] object-contain" />
            ))}
          </div>
        ) : null}
        {slide.error ? <p className="mt-auto text-[11px] text-red-600">{slide.error}</p> : null}
      </div>
    </div>
  );
}

/** A grid of cell text: sticky header row, row numbers, horizontal scroll. */
function Grid({ rows, firstRowIsHeader = true }: { rows: string[][]; firstRowIsHeader?: boolean }) {
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-xs text-muted-foreground">This sheet has no cells.</p>;
  }
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return (
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-border/70">
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r % 2 === 0 ? "bg-background" : "bg-muted/20"}>
              <th
                scope="row"
                className="sticky left-0 z-10 w-9 border-r border-border/50 bg-muted/40 px-1 py-1 text-right font-normal tabular-nums text-muted-foreground/70"
              >
                {r + 1}
              </th>
              {Array.from({ length: width }, (_, c) => {
                const value = row[c] ?? "";
                const header = firstRowIsHeader && r === 0;
                const numeric = value !== "" && /^-?[\d.,]+%?$/.test(value);
                return (
                  <td
                    key={c}
                    className={
                      "max-w-[18rem] truncate border-b border-border/40 px-2 py-1 " +
                      (header ? "font-medium text-foreground" : "text-foreground/80") +
                      (numeric ? " text-right tabular-nums" : "")
                    }
                    title={value.length > 40 ? value : undefined}
                  >
                    {value || "\u00a0"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlideDeck({ file }: { file: Extract<OpenedFile, { kind: "slides" }> }) {
  const [index, setIndex] = useState(0);
  const deck = file.deck.deck;
  const slide = deck.slides[Math.min(index, deck.slides.length - 1)];
  const at = deck.slides.indexOf(slide);
  const urls = file.deck.images[at] ?? [];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") setIndex((n) => Math.min(deck.slides.length - 1, n + 1));
      else if (event.key === "ArrowLeft") setIndex((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.slides.length]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIndex((n) => Math.max(0, n - 1))}
          disabled={index === 0}
          aria-label="Previous slide"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="w-16 text-center text-[11px] tabular-nums text-muted-foreground">
          {index + 1} / {deck.slides.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIndex((n) => Math.min(deck.slides.length - 1, n + 1))}
          disabled={index >= deck.slides.length - 1}
          aria-label="Next slide"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <span className="ml-2 text-[10px] text-muted-foreground/70">
          {deck.width.toFixed(2)}×{deck.height.toFixed(2)} in
        </span>
      </div>

      <SlideFace key={slide?.part} slide={slide} urls={urls} ratio={deck.width / deck.height} />

      {deck.slides.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {deck.slides.map((entry, n) => (
            <button
              key={entry.part}
              type="button"
              onClick={() => setIndex(n)}
              title={entry.title || `Slide ${entry.number}`}
              className={
                "flex h-12 w-20 shrink-0 flex-col justify-between rounded border px-1.5 py-1 text-left text-[9px] leading-tight transition-colors " +
                (n === at
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
    </div>
  );
}

function SheetBook({ sheets }: { sheets: SheetTable[] }) {
  const [active, setActive] = useState(0);
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div className="space-y-2">
      {sheets.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {sheets.map((entry, n) => (
            <button
              key={entry.name + n}
              type="button"
              onClick={() => setActive(n)}
              className={
                "rounded border px-2 py-0.5 text-[11px] transition-colors " +
                (n === active
                  ? "border-primary/70 bg-accent text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-foreground/30")
              }
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
      <Grid rows={sheet.rows} />
      <p className="text-[10px] text-muted-foreground/70">
        {sheet.rows.length} rows · {sheet.rows[0]?.length ?? 0} columns · values only, no formatting
      </p>
    </div>
  );
}

export function FileViewer({ open, onOpenChange, initial, initialSource }: FileViewerProps) {
  const [picked, setPicked] = useState<OpenedFile | null>(null);
  const [ownSource, setOwnSource] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickedRef = useRef<OpenedFile | null>(null);

  const createUpload = useMutation(api.cloud.createUpload);
  const convertBlob = useAction(api.convert.blob);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState<string | null>(null);

  const file = picked ?? initial ?? null;
  /** A locally picked file wins over the caller's, because it is the newer one. */
  const source = picked ? ownSource : initialSource ?? null;
  const targets = source ? conversionTargets(source.name) : [];

  const close = (next: boolean) => {
    if (!next) {
      if (pickedRef.current) disposeOpenedFile(pickedRef.current);
      pickedRef.current = null;
      setPicked(null);
      setOwnSource(null);
      setError(null);
      setNote(null);
      setConvertOpen(false);
    }
    onOpenChange(next);
  };

  const readFile = async (name: string, bytes: Uint8Array) => {
    setBusy(true);
    setError(null);
    try {
      const opened = await openOfficeFile(name, bytes);
      if (pickedRef.current) disposeOpenedFile(pickedRef.current);
      pickedRef.current = opened;
      setPicked(opened);
      setOwnSource({ name, bytes });
      setNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Convert the open file and download the result.
   *
   * The bytes go to Convex storage first only because an action argument is not
   * a file channel; the action deletes that temporary blob itself, and the
   * converted file is downloaded straight from the storage URL. Nothing lands
   * in the author's cloud unless they save it there deliberately.
   */
  const convert = async (target: string) => {
    if (!source || converting) return;
    setConverting(target);
    setError(null);
    setNote(null);
    try {
      const mime = mimeForTarget(extensionOf(source.name));
      const uploadUrl = await createUpload({});
      const upload = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: new Blob([source.bytes as unknown as BlobPart], { type: mime }),
      });
      if (!upload.ok) throw new Error("Could not hand that file to the converter.");
      const body = (await upload.json()) as { storageId?: Id<"_storage"> };
      if (!body.storageId) throw new Error("The upload returned no file id.");

      const result = await convertBlob({
        storageId: body.storageId,
        name: source.name,
        mime,
        target,
        temporary: true,
      });
      setNote(
        `${result.name} · ${Math.round(result.size / 1024)} KB${
          result.engine === "CONVERT_API_SANDBOX_KEY" ? " · sandbox token" : ""
        }`,
      );
      setConvertOpen(false);

      if (result.url) {
        const anchor = document.createElement("a");
        anchor.href = result.url;
        anchor.download = result.name;
        anchor.rel = "noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not convert that file.");
    } finally {
      setConverting(null);
    }
  };

  const Icon =
    file?.kind === "sheet" ? FileSpreadsheet : file?.kind === "doc" || file?.kind === "csv" ? FileText : Presentation;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto p-4 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4" />
            File viewer
          </DialogTitle>
          <DialogDescription className="pr-6 text-xs sm:text-sm">
            Open a .pptx, .xlsx, .docx, .csv or .tsv and read it here — no PowerPoint, Excel or Word.
            Reading stays in the browser; converting sends that one file to ConvertAPI.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              void chosen
                .arrayBuffer()
                .then((buffer) => readFile(chosen.name, new Uint8Array(buffer)))
                .catch((err) =>
                  setError(err instanceof Error ? err.message : "Could not read that file."),
                );
            }}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <FileUp className="size-3.5" />
            Choose file
          </Button>
          {file ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {file.name}
              {file.kind === "slides"
                ? ` · ${file.deck.deck.slides.length} slides`
                : file.kind === "sheet"
                  ? ` · ${file.sheets.length} sheet${file.sheets.length === 1 ? "" : "s"}`
                  : file.kind === "doc"
                    ? ` · ${file.view.paragraphs.length} paragraphs`
                    : ` · ${file.rows.length} rows`}
            </span>
          ) : null}
          {source && targets.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConvertOpen((value) => !value)}
              disabled={converting !== null}
              aria-expanded={convertOpen}
            >
              {converting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowLeftRight className="size-3.5" />
              )}
              {converting ? "Converting…" : "Convert"}
            </Button>
          ) : null}
          {note ? (
            <span className="min-w-0 truncate text-[11px] text-emerald-600 dark:text-emerald-400">
              {note}
            </span>
          ) : null}
        </div>

        {convertOpen && source ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Convert to
            </span>
            {targets.map((target) => (
              <button
                key={target.ext}
                onClick={() => void convert(target.ext)}
                disabled={converting !== null}
                className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {converting === target.ext ? "Working…" : target.label}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground/60">
              · downloads straight away, nothing added to your cloud
            </span>
          </div>
        ) : null}

        {busy ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the file…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <X className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : file?.kind === "slides" ? (
          <SlideDeck file={file} />
        ) : file?.kind === "sheet" ? (
          <SheetBook sheets={file.sheets} />
        ) : file?.kind === "doc" ? (
          <div className="max-h-[60vh] space-y-3 overflow-auto rounded-lg border border-border/70 p-3">
            {file.view.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-[12px] leading-relaxed text-foreground/85">
                {paragraph}
              </p>
            ))}
            {file.view.tables.map((table, index) => (
              <div key={index} className="pt-1">
                <Grid rows={table.rows} />
              </div>
            ))}
          </div>
        ) : file?.kind === "csv" ? (
          <div className="space-y-2">
            <Grid rows={file.rows} />
            <p className="text-[10px] text-muted-foreground/70">
              {file.rows.length} rows · split on {file.delimiter === "\t" ? "tabs" : `“${file.delimiter}”`}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
            <Presentation className="mx-auto size-5 text-muted-foreground/60" />
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing open yet — choose a file, or press View in the studio.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
