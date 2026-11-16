import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronRight,
  Download,
  FileJson,
  Loader2,
  Presentation,
  QrCode,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buildPptx, deckFileName } from "@/lib/pptx/render";
import { themeById, themeList, suggestTheme, type ThemeId } from "@/lib/pptx/theme";
import type { DeckSpec, SlideSpec } from "@/lib/pptx/spec";
import { qrMatrix } from "@/lib/qr/qr";
import { qrDataUrl } from "@/lib/qr/png";

// ---------------------------------------------------------------------------
// Deck Studio.
//
// Generation is staged, so this panel is a loop rather than a spinner: it asks
// the backend for the next batch until the deck reports itself finished. That
// is what lets a 60-slide deck work — one request would time out long before
// the last slide — and it is why the progress bar counts written slides rather
// than showing an indeterminate animation.
//
// The preview is drawn from the same spec the .pptx writer consumes, so what a
// thumbnail shows is what the download contains: same theme, same copy, same
// ordering. It is a hand-built miniature, not a rendered picture of the file.
// ---------------------------------------------------------------------------

const COUNTS = [10, 14, 20, 30, 50];

/**
 * A QR code drawn on a canvas.
 *
 * A grid of divs would be thousands of nodes for a version-10 code, and a data
 * URL would mean re-encoding on every render; a canvas draws it once per text
 * change and stays crisp at any size.
 */
function QrPreview({
  text,
  size = 112,
  dark = "#000000",
  light = "#FFFFFF",
}: {
  text: string;
  size?: number;
  dark?: string;
  light?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modules = useMemo(() => {
    try {
      return qrMatrix(text).modules;
    } catch {
      return null;
    }
  }, [text]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = light;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!modules) return;
    const margin = 2;
    const count = modules.length + margin * 2;
    const scale = canvas.width / count;
    context.fillStyle = dark;
    for (let y = 0; y < modules.length; y += 1) {
      for (let x = 0; x < modules.length; x += 1) {
        if (!modules[y][x]) continue;
        context.fillRect((x + margin) * scale, (y + margin) * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
  }, [modules, dark, light]);

  return <canvas ref={canvasRef} width={size} height={size} className="rounded-sm" aria-label="QR code preview" />;
}

function SlideThumb({ slide, themeId, index }: { slide: SlideSpec; themeId: string; index: number }) {
  const t = themeById(themeId);
  const body = slide.body ?? [];
  const accent = t.accent;

  const frame = (children: React.ReactNode, pad = "p-3") => (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden ${pad}`}
      style={{ background: `#${t.bg}`, color: `#${t.ink}` }}
    >
      <div className="absolute right-2 top-2 text-[7px] font-semibold tracking-widest" style={{ color: `#${t.muted}` }}>
        {String(index + 1).padStart(2, "0")}
      </div>
      {children}
    </div>
  );

  if (slide.kind === "cover") {
    return frame(
      <div className="flex h-full flex-col justify-center">
        <div className="mb-2 h-[3px] w-8" style={{ background: accent }} />
        <div className="text-[13px] font-bold leading-tight">{slide.title}</div>
        {slide.subtitle ? (
          <div className="mt-1.5 line-clamp-2 text-[8px] leading-snug" style={{ color: `#${t.muted}` }}>
            {slide.subtitle}
          </div>
        ) : null}
      </div>,
      "px-4 py-3",
    );
  }

  if (slide.kind === "section") {
    return frame(
      <div className="flex h-full flex-col justify-center">
        <div className="text-[9px] font-bold tracking-widest" style={{ color: accent }}>
          {String(index).padStart(2, "0")}
        </div>
        <div className="mt-1 text-[14px] font-bold leading-tight">{slide.title}</div>
        {slide.subtitle ? (
          <div className="mt-1 line-clamp-2 text-[8px]" style={{ color: `#${t.muted}` }}>
            {slide.subtitle}
          </div>
        ) : null}
      </div>,
      "px-4 py-3",
    );
  }

  if (slide.kind === "quote") {
    return frame(
      <div className="flex h-full flex-col justify-center">
        <div className="text-[22px] leading-none" style={{ color: accent }}>
          “
        </div>
        <div className="line-clamp-4 text-[9px] italic leading-snug">{slide.quote?.text ?? slide.title}</div>
        <div className="mt-1 text-[7px]" style={{ color: `#${t.muted}` }}>
          {slide.quote?.attribution}
        </div>
      </div>,
      "px-4 py-3",
    );
  }

  if (slide.kind === "stats") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-auto flex gap-1.5">
          {(slide.metrics ?? []).slice(0, 3).map((m, i) => (
            <div key={`${m.label}-${i}`} className="flex-1 rounded-sm p-1.5" style={{ background: `#${t.panel}` }}>
              <div className="text-[11px] font-bold" style={{ color: i % 2 ? t.accentAlt : accent }}>
                {m.value}
              </div>
              <div className="line-clamp-2 text-[6px] leading-tight" style={{ color: `#${t.muted}` }}>
                {m.label}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (slide.kind === "chart") {
    const values = (slide.chart?.series ?? []).flatMap((s) => s.values);
    const max = Math.max(1, ...values.map((v) => Math.abs(v)));
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-2 flex h-14 items-end gap-1">
          {(slide.chart?.series ?? []).slice(0, 2).flatMap((series, si) =>
            series.values.slice(0, 6).map((value, i) => (
              <div
                key={`${si}-${i}`}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${Math.max(6, (Math.abs(value) / max) * 100)}%`,
                  background: si === 0 ? accent : t.accentAlt,
                  opacity: 0.9,
                }}
              />
            )),
          )}
        </div>
        <div className="mt-1 line-clamp-1 text-[6px]" style={{ color: `#${t.muted}` }}>
          {slide.chart?.caption}
        </div>
      </>
    );
  }

  if (slide.kind === "table") {
    const table = slide.table;
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-2 overflow-hidden rounded-sm border" style={{ borderColor: `#${t.line}` }}>
          <div className="flex text-[6px] font-semibold" style={{ background: accent, color: `#${t.bg}` }}>
            {(table?.columns ?? []).slice(0, 4).map((c, i) => (
              <div key={`${c}-${i}`} className="flex-1 truncate px-1 py-0.5">
                {c}
              </div>
            ))}
          </div>
          {(table?.rows ?? []).slice(0, 3).map((row, r) => (
            <div key={r} className="flex text-[6px]" style={{ background: r % 2 ? `#${t.panelAlt}` : `#${t.panel}` }}>
              {row.slice(0, 4).map((cell, c) => (
                <div key={c} className="flex-1 truncate px-1 py-0.5">
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }

  if (slide.kind === "timeline") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-3 flex items-start gap-1">
          {(slide.steps ?? []).slice(0, 4).map((step, i) => (
            <div key={`${step.title}-${i}`} className="flex-1">
              <div className="mb-1 h-[2px] w-full" style={{ background: i === 0 ? accent : `#${t.line}` }} />
              <div className="text-[5px] uppercase tracking-wide" style={{ color: accent }}>
                {step.when}
              </div>
              <div className="text-[7px] font-semibold leading-tight">{step.title}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (slide.kind === "columns") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-2 flex gap-1.5">
          {(slide.columns ?? []).slice(0, 2).map((column, i) => (
            <div key={`${column.heading}-${i}`} className="flex-1 rounded-sm p-1.5" style={{ background: `#${t.panel}` }}>
              <div className="mb-1 text-[6px] font-bold uppercase" style={{ color: i === 0 ? accent : t.accentAlt }}>
                {column.heading}
              </div>
              {column.points.slice(0, 3).map((point, p) => (
                <div key={p} className="truncate text-[6px]" style={{ color: `#${t.muted}` }}>
                  • {point}
                </div>
              ))}
            </div>
          ))}
        </div>
      </>
    );
  }

  if (slide.kind === "qr") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-1 flex flex-1 items-center justify-center">
          <QrPreview text={slide.qr?.url ?? "https://example.com"} size={80} light={`#${t.panel}`} dark={`#${t.ink}`} />
        </div>
        <div className="line-clamp-1 text-[6px]" style={{ color: `#${t.muted}` }}>
          {slide.qr?.label ?? slide.qr?.url}
        </div>
      </>
    );
  }

  if (slide.kind === "image") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-2 flex flex-1 items-center justify-center rounded-sm" style={{ background: `#${t.panel}` }}>
          <div className="flex size-10 items-center justify-center rounded-full border" style={{ borderColor: accent }}>
            <div className="size-4 rounded-full border" style={{ borderColor: `#${t.muted}` }} />
          </div>
        </div>
        <div className="mt-1 line-clamp-1 text-[6px]" style={{ color: `#${t.muted}` }}>
          {slide.image?.caption ?? "Visual placeholder"}
        </div>
      </>
    );
  }

  if (slide.kind === "agenda") {
    return frame(
      <>
        <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
        <div className="mt-2 space-y-1">
          {body.slice(0, 5).map((item, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="text-[6px] font-bold" style={{ color: accent }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="truncate text-[7px]">{item}</span>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (slide.kind === "closing") {
    return frame(
      <div className="flex h-full flex-col items-center justify-center text-center">
        <div className="text-[14px] font-bold">{slide.title}</div>
        {slide.subtitle ? (
          <div className="mt-1 line-clamp-2 text-[7px]" style={{ color: `#${t.muted}` }}>
            {slide.subtitle}
          </div>
        ) : null}
      </div>,
      "px-4 py-3",
    );
  }

  return frame(
    <>
      <div className="text-[10px] font-semibold leading-tight">{slide.title}</div>
      <div className="mt-2 space-y-1">
        {body.slice(0, 4).map((line, i) => (
          <div key={i} className="flex gap-1">
            <span className="mt-[3px] size-1 shrink-0 rounded-full" style={{ background: accent }} />
            <span className="line-clamp-1 text-[7px]">{line.replace(/\*\*/g, "")}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function DeckStudio({
  initialTopic,
  onClose,
}: {
  initialTopic: string;
  onClose: () => void;
}) {
  const [topic, setTopic] = useState(initialTopic.slice(0, 400));
  const [slideCount, setSlideCount] = useState(14);
  const [theme, setTheme] = useState<ThemeId>(() => suggestTheme(initialTopic).id);
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("");
  const [deckId, setDeckId] = useState<Id<"decks"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [qrUrl, setQrUrl] = useState("");
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const runToken = useRef(0);

  const startDeck = useAction(api.decks.start);
  const stepDeck = useAction(api.decks.step);
  const retheme = useMutation(api.decks.retheme);
  const deleteDeck = useMutation(api.decks.remove);

  const recent = useQuery(api.decks.list, {});
  const deck = useQuery(api.decks.get, deckId ? { deckId } : "skip");

  const slides = useMemo(() => (deck?.slides ?? []) as SlideSpec[], [deck]);
  const total = deck?.total ?? 0;
  const written = deck?.written ?? 0;
  const finished = deck?.status === "done";

  const spec: DeckSpec | null = deck
    ? {
        title: deck.title,
        theme: deck.theme,
        ratio: "16:9",
        transition: "fade",
        footer: undefined,
        slides,
      }
    : null;

  /** Ask for batches until the backend says the deck is finished. */
  const drive = async (id: Id<"decks">, token: number) => {
    for (let guard = 0; guard < 160; guard += 1) {
      if (runToken.current !== token) return;
      const next = await stepDeck({ deckId: id });
      if (!next) return;
      if (next.status === "done" || next.status === "failed") return;
    }
  };

  const run = async () => {
    const text = topic.trim();
    if (!text || busy) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setBusy(true);
    setError(null);
    setSelected(0);
    try {
      const created = await startDeck({
        topic: text,
        slideCount,
        theme,
        ...(tone.trim() ? { tone: tone.trim() } : {}),
        ...(audience.trim() ? { audience: audience.trim() } : {}),
        ...(qrUrl.trim() ? { qrUrl: qrUrl.trim() } : {}),
      });
      if (!created) throw new Error("The deck could not be created.");
      setDeckId(created._id);
      await drive(created._id, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deck generation failed.");
    } finally {
      if (runToken.current === token) setBusy(false);
    }
  };

  const resume = async (id: Id<"decks">) => {
    if (busy) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setDeckId(id);
    setSelected(0);
    setBusy(true);
    setError(null);
    try {
      await drive(id, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deck generation failed.");
    } finally {
      if (runToken.current === token) setBusy(false);
    }
  };

  const stop = () => {
    runToken.current += 1;
    setBusy(false);
  };

  /** Standalone PNG, for a poster, another deck, or a chat message. */
  const makeQrPng = async () => {
    const text = qrUrl.trim();
    if (!text || qrBusy) return;
    setQrBusy(true);
    setError(null);
    try {
      setQrPng(await qrDataUrl(text, { scale: 10, margin: 4 }));
    } catch (err) {
      setQrPng(null);
      setError(err instanceof Error ? err.message : "Could not encode that link.");
    } finally {
      setQrBusy(false);
    }
  };

  const downloadQr = () => {
    if (!qrPng) return;
    const anchor = document.createElement("a");
    anchor.href = qrPng;
    anchor.download = "qr-code.png";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const download = async () => {
    if (!spec || downloading || slides.length === 0) return;
    setDownloading(true);
    try {
      const bytes = await buildPptx(spec);
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = deckFileName(spec.title);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the file.");
    } finally {
      setDownloading(false);
    }
  };

  const current = slides[Math.min(selected, Math.max(0, slides.length - 1))];
  const activeTheme = deck ? themeById(deck.theme) : themeById(theme);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="border-t px-4 py-3 sm:px-6"
    >
      <div className="mx-auto max-w-3xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Presentation className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Deck studio
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            AI copy · real .pptx · native charts, tables and notes
          </span>
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3" />
          </button>
        </div>

        {/* Brief */}
        <div className="rounded-lg border border-border/60 p-2">
          <textarea
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (!deckId) setTheme(suggestTheme(e.target.value).id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            rows={2}
            maxLength={400}
            placeholder="A deck on what changed in on-device AI, for a product review…"
            aria-label="Deck topic"
            className="w-full resize-none bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">Slides</span>
            {COUNTS.map((count) => (
              <button
                key={count}
                onClick={() => setSlideCount(count)}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  slideCount === count
                    ? "border-foreground/30 bg-accent text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-accent/50"
                }`}
              >
                {count}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">Theme</span>
            {themeList().map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  setTheme(option.id);
                  if (deckId) void retheme({ deckId, theme: option.id });
                }}
                title={option.mood}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  (deck?.theme ?? theme) === option.id
                    ? "border-foreground/30 bg-accent text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-accent/50"
                }`}
              >
                <span className="flex">
                  <span className="size-2 rounded-full" style={{ background: `#${option.bg}`, border: `1px solid #${option.line}` }} />
                  <span className="-ml-0.5 size-2 rounded-full" style={{ background: `#${option.accent}` }} />
                </span>
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              maxLength={120}
              placeholder="Audience (optional)"
              className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50"
            />
            <input
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              maxLength={120}
              placeholder="Tone (optional)"
              className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="mt-2 flex items-center gap-2">
            <QrCode className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              value={qrUrl}
              onChange={(e) => {
                setQrUrl(e.target.value);
                setQrPng(null);
              }}
              maxLength={600}
              placeholder="QR link (optional) — YouTube, repo, website"
              aria-label="Link for a QR code"
              className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={() => void makeQrPng()}
              disabled={qrBusy || !qrUrl.trim()}
              title="Encode this link as a PNG"
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {qrBusy ? <Loader2 className="size-3 animate-spin" /> : <QrCode className="size-3" />}
              PNG
            </button>
          </div>

          {qrPng ? (
            <div className="mt-2 flex items-center gap-2 rounded border border-border/60 p-2">
              <img
                src={qrPng}
                alt="QR code"
                className="size-20 rounded border border-border/60 bg-white p-1"
              />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">
                  Encoded in the browser — the link is never sent to a QR service. Add it to the deck by
                  keeping the field filled when you build.
                </p>
                <button
                  onClick={downloadQr}
                  className="mt-1 inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent"
                >
                  <Download className="size-3" /> Download PNG
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void run()}
              disabled={busy || !topic.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
              {busy ? "Writing deck…" : deckId ? "Build another" : "Build deck"}
            </button>
            {busy ? (
              <button
                onClick={stop}
                className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Square className="size-2.5" /> Stop
              </button>
            ) : null}
            {deck && slides.length > 0 ? (
              <button
                onClick={() => void download()}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                {downloading ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                {downloading ? "Packaging…" : "Download .pptx"}
              </button>
            ) : null}
            <span className="ml-auto text-[10px] text-muted-foreground/70">
              {slides.length} of {total || slideCount} slides
            </span>
          </div>

          {deck ? (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${total ? Math.min(100, (written / total) * 100) : 0}%` }}
              />
            </div>
          ) : null}

          {busy && deck ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {deck.status === "writing"
                ? `Writing slides ${Math.min(written + 1, total)}–${Math.min(written + 3, total)} of ${total}${
                    deck.engine ? ` · ${deck.engine}` : ""
                  }`
                : "Finishing"}
            </p>
          ) : null}

          {finished && deck ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {slides.length} slides · theme {activeTheme.label} · speaker notes on every slide
              {deck.engine ? ` · written by ${deck.engine}` : ""}
            </p>
          ) : null}

          {deck?.error ? (
            <p className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-300">
              {deck.aiFailures ? "Partly written from templates — " : ""}
              {deck.error}
            </p>
          ) : null}

          {error ? <p className="mt-1.5 text-[10px] text-destructive">{error}</p> : null}
        </div>

        {/* Previews */}
        {slides.length > 0 ? (
          <>
            <div className="mt-3 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {slides.map((slide, index) => (
                <button
                  key={index}
                  onClick={() => setSelected(index)}
                  className={`group relative aspect-video overflow-hidden rounded-md border text-left transition-all ${
                    index === selected ? "border-primary/60 ring-1 ring-primary/30" : "border-border/60 hover:border-foreground/30"
                  }`}
                >
                  <SlideThumb slide={slide} themeId={deck?.theme ?? theme} index={index} />
                </button>
              ))}
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-lg border border-border/60 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                  <ChevronRight className="size-3" /> Slide {selected + 1} · {current?.kind}
                </div>
                <p className="text-xs font-medium">{current?.title}</p>
                {current?.subtitle ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{current.subtitle}</p>
                ) : null}
                {(current?.body ?? []).slice(0, 4).map((line, i) => (
                  <p key={i} className="mt-0.5 text-[11px] text-muted-foreground">
                    · {line.replace(/\*\*/g, "")}
                  </p>
                ))}
              </div>
              <div className="rounded-lg border border-border/60 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                  <FileJson className="size-3" /> Speaker notes
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {current?.notes ?? "No notes on this slide yet."}
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border/60 px-3 py-4 text-center">
            <Sparkles className="mx-auto size-4 text-muted-foreground/60" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              The outline is written first, then slides in batches. A 50-slide deck is ~17 model calls — stop
              any time, the written slides are kept.
            </p>
          </div>
        )}

        {/* Recent decks */}
        {recent && recent.length > 0 ? (
          <div className="mt-3">
            <div className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground/60">Your decks</div>
            <div className="space-y-1">
              {recent.map((item) => (
                <div
                  key={item._id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-[11px] transition-colors ${
                    item._id === deckId ? "border-primary/40 bg-accent/50" : "border-border/50 hover:bg-accent/40"
                  }`}
                >
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => void resume(item._id)}>
                    {item.title}
                  </button>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {item.written}/{item.total}
                    {item.status === "done" ? "" : " · paused"}
                  </span>
                  <button
                    onClick={() => void deleteDeck({ deckId: item._id })}
                    className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-destructive"
                    title="Delete deck"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
