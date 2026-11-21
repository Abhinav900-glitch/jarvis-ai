import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileJson,
  Globe,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
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
import { FileViewer } from "@/components/file-viewer";
import { disposeOpenedFile, openOfficeFile, type OpenedFile } from "@/lib/office/read";
import {
  DECK_TOPICS,
  type DeckTopic,
} from "@/lib/topics";

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
 * The three steers people type most often.
 *
 * A prompt box is empty exactly when the author does not know what the model
 * can do with a slide, so the chips are the affordance: click one and the
 * instruction is filled in, still editable before Rewrite runs.
 */
const QUICK_REWRITES: { label: string; hint: string }[] = [
  {
    label: "More detail",
    hint: "Add one more concrete bullet with a figure from the research notes, plus a speaker note that says what to point at.",
  },
  { label: "Shorter", hint: "Cut this to a single tight bullet and a title under eight words." },
  {
    label: "Add a source",
    hint: "Keep the copy and name the source of this slide's main figure in the speaker notes.",
  },
];

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
        <div className="mt-2 flex flex-1 items-center justify-center overflow-hidden rounded-sm" style={{ background: `#${t.panel}` }}>
          {slide.image?.dataUrl ? (
            <img
              src={slide.image.dataUrl}
              alt={slide.image.caption ?? ""}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-full border" style={{ borderColor: accent }}>
              <div className="size-4 rounded-full border" style={{ borderColor: `#${t.muted}` }} />
            </div>
          )}
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
  topic: selectedTopic,
  onTopicSelect,
  onClose,
  autoStart = false,
  onSendToStudio,
}: {
  initialTopic: string;
  topic: DeckTopic | null;
  onTopicSelect: (topic: DeckTopic) => void;
  onClose: () => void;
  /** Forwarded to the viewer: an opened image can become a studio seed. */
  onSendToStudio?: (image: { name: string; url: string; storageId: Id<"_storage"> }) => void;
  /**
   * Start writing as soon as the panel opens. Used when the panel is the
   * fallback for a slides request that already failed elsewhere: the user asked
   * for a deck, so making them press Build again would be asking twice.
   */
  autoStart?: boolean;
}) {
  const [topic, setTopic] = useState(
    (selectedTopic?.title ?? initialTopic).slice(0, 400),
  );
  /** The topic picker answers "what do you want to understand?" in one click. */
  // Opened with no brief, the first useful question is the topic itself.
  const [showTopics, setShowTopics] = useState(
    !(selectedTopic?.title ?? initialTopic).trim(),
  );
  /**
   * Teaching mode writes for a learner, not a boardroom: every term defined, a
   * worked example per idea, the likely misconceptions named, and a check for
   * understanding at the end.
   */
  const [studentMode, setStudentMode] = useState(true);

  const [slideCount, setSlideCount] = useState(14);
  const [theme, setTheme] = useState<ThemeId>(() => suggestTheme(initialTopic).id);
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("");
  const [deckId, setDeckId] = useState<Id<"decks"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // The viewer gets the real packaged bytes, so the preview is the download.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<OpenedFile | null>(null);
  /** The packaged bytes, so the viewer can convert the deck it is showing. */
  const [viewerSource, setViewerSource] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [qrUrl, setQrUrl] = useState("");
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [template, setTemplate] = useState<{ storageId: Id<"_storage">; name: string } | null>(null);
  const [templateIndex, setTemplateIndex] = useState(0);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    subtitle: string;
    body: string;
    notes: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [rewriteHint, setRewriteHint] = useState("");
  /** Search the web before writing, and let the slides quote what it found. */
  const [withResearch, setWithResearch] = useState(true);
  /** Which slide is waiting on an image, so only that button spins. */
  const [imageBusy, setImageBusy] = useState<number | null>(null);
  const [imageHint, setImageHint] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rendered, setRendered] = useState<{ url: string | null; bytes: number; slides: number } | null>(null);
  const runToken = useRef(0);

  const startDeck = useAction(api.decks.start);
  const stepDeck = useAction(api.decks.step);
  const retheme = useMutation(api.decks.retheme);
  const deleteDeck = useMutation(api.decks.remove);
  const createUpload = useMutation(api.cloud.createUpload);
  const renderTemplate = useAction(api.deckTemplate.render);
  const editSlideAction = useMutation(api.decks.editSlide);
  const rewriteSlideAction = useAction(api.decks.rewrite);
  const findImageAction = useAction(api.deckImages.find);
  const addSlideAction = useMutation(api.decks.addSlide);
  const duplicateSlideAction = useMutation(api.decks.duplicateSlide);
  const removeSlideAction = useMutation(api.decks.removeSlide);
  const moveSlideAction = useMutation(api.decks.moveSlide);
  const sourcesSlideAction = useMutation(api.decks.addSourcesSlide);
  const [slideBusy, setSlideBusy] = useState(false);
  /** The tile being dragged, and the tile it is hovering over. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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

  /** `override` lets a topic tile start the build in the same click. */
  const run = async (override?: string) => {
    const text = (override ?? topic).trim();
    if (!text || busy) return;
    const token = runToken.current + 1;
    runToken.current = token;
    setBusy(true);
    setError(null);
    setSelected(0);

    // Both prompts read these fields, so the teaching brief travels with the
    // deck without a second schema: audience says who is learning, tone says
    // how thoroughly each idea has to be explained.
    const briefAudience = [
      audience.trim(),
      studentMode
        ? "a student meeting this topic for the first time, who needs every part of it explained rather than summarised"
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    const briefTone = [
      tone.trim(),
      studentMode
        ? "patient and precise. Define every term on the slide where it first appears and do not repeat a definition on a later slide; show a worked example for each method; name the two most likely misconceptions and correct them; put a slide titled 'Check your understanding' immediately before the closing, with one question on it and its answer in the speaker notes"
        : "",
    ]
      .filter(Boolean)
      .join("; ");

    try {
      const created = await startDeck({
        topic: text,
        slideCount,
        theme,
        research: withResearch,
        ...(briefTone ? { tone: briefTone } : {}),
        ...(briefAudience ? { audience: briefAudience } : {}),
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

  // An auto-start runs once per mount, even though `run` is a new closure each
  // render — the ref is what makes the dependency list honest without
  // restarting the deck every time a keystroke re-renders the panel.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
  }, [autoStart]);

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

  /** Upload a .pptx template straight to storage, then remember its id. */
  const uploadTemplate = async (file: File) => {
    if (templateBusy) return;
    if (!/\.pptx$/i.test(file.name)) {
      setError("Pick a .pptx file — that is what the template API accepts.");
      return;
    }
    setTemplateBusy(true);
    setError(null);
    setRendered(null);
    try {
      const url = await createUpload({});
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        },
        body: file,
      });
      if (!response.ok) throw new Error("The upload failed.");
      const body = (await response.json()) as { storageId?: Id<"_storage"> };
      if (!body.storageId) throw new Error("The upload returned no file id.");
      setTemplate({ storageId: body.storageId, name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the template.");
    } finally {
      setTemplateBusy(false);
    }
  };

  const renderInto = async () => {
    if (!deckId || !template || templateBusy) return;
    setTemplateBusy(true);
    setError(null);
    try {
      const result = await renderTemplate({
        deckId,
        templateStorageId: template.storageId,
        templateName: template.name,
        slideIndex: templateIndex,
      });
      setRendered({ url: result.url, bytes: result.bytes, slides: result.slides });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The template render failed.");
    } finally {
      setTemplateBusy(false);
    }
  };

  const startEdit = (slide: SlideSpec) => {
    setEditDraft({
      title: slide.title,
      subtitle: slide.subtitle ?? "",
      body: (slide.body ?? []).join("\n"),
      notes: slide.notes ?? "",
    });
  };

  /** Save one slide. No model call: the stored spec is what the file is built from. */
  const saveEdit = async () => {
    if (!deckId || !editDraft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await editSlideAction({
        deckId,
        index: selected,
        title: editDraft.title,
        subtitle: editDraft.subtitle,
        body: editDraft.body.split(/\n+/),
        notes: editDraft.notes,
      });
      setEditDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that slide.");
    } finally {
      setSaving(false);
    }
  };

  /** Rewrite this slide with the model, keeping its layout and its data. */
  const rewriteCurrent = async () => {
    if (!deckId || rewriting) return;
    if (!editDraft) {
      const slide = slides[selected];
      if (slide) startEdit(slide);
    }
    setRewriting(true);
    setError(null);
    try {
      await rewriteSlideAction({
        deckId,
        index: selected,
        instruction: rewriteHint.trim() || undefined,
      });
      setRewriteHint("");
      setEditDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rewrite that slide.");
    } finally {
      setRewriting(false);
    }
  };

  /**
   * Put a real web picture on one slide.
   *
   * Only image slides render `image`, so this is offered where it lands. A
   * failed search leaves the placeholder in place and says why — an empty
   * frame with no message reads as a broken button.
   */
  const findImage = async (index: number) => {
    if (!deckId || imageBusy !== null) return;
    setImageBusy(index);
    setError(null);
    try {
      const hint = imageHint.trim();
      const result = await findImageAction({
        deckId,
        index,
        ...(hint ? { query: hint } : {}),
      });
      if (!result.ok) setError(result.reason ?? "No picture could be attached to that slide.");
      else setImageHint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach a picture.");
    } finally {
      setImageBusy(null);
    }
  };

  /** Fill every image slide that is still a placeholder, one at a time. */
  const fillImageSlides = async () => {
    if (!deckId || imageBusy !== null) return;
    const pending = slides
      .map((slide, index) => ({ slide, index }))
      .filter(({ slide }) => slide.kind === "image" && !slide.image?.dataUrl);
    setError(null);
    for (const { index } of pending) {
      setImageBusy(index);
      try {
        const result = await findImageAction({ deckId, index });
        if (!result.ok && result.reason) setError(result.reason);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not attach a picture.");
      }
    }
    setImageBusy(null);
  };

  /**
   * Slide-level structure: add, copy, move, delete, and the sources slide.
   *
   * All five are deck-spec writes, so none of them needs a model call and the
   * downloaded file reflects the change immediately. `next` is where the
   * selection should land afterwards — without it, deleting a slide leaves the
   * panel pointing at whatever slid into its place.
   */
  const restructure = async (work: () => Promise<unknown>, next?: number) => {
    if (!deckId || slideBusy) return;
    setSlideBusy(true);
    setError(null);
    setEditDraft(null);
    try {
      await work();
      if (typeof next === "number") setSelected(Math.max(0, next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the slides.");
    } finally {
      setSlideBusy(false);
    }
  };

  /**
   * Reorder by dropping one thumbnail onto another.
   *
   * The drop index is the tile's own index, not "before" or "after" it: the
   * arrows move by one and the drag moves by however far it was dragged, and
   * both end up at a position the author can see. The index also comes from
   * the drag state rather than only from `dataTransfer`, because Firefox will
   * not expose data during `dragover` and Safari sometimes drops it.
   */
  const dropOn = (from: number, to: number) => {
    setDragIndex(null);
    setDragOver(null);
    if (!deckId || from === to || from < 0 || to < 0) return;
    void restructure(() => moveSlideAction({ deckId, from, to }), to);
  };

  const moveCurrent = (direction: -1 | 1) => {
    if (!deckId) return;
    const to = selected + direction;
    if (to < 0 || to >= slides.length) return;
    void restructure(() => moveSlideAction({ deckId, from: selected, to }), to);
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts.
  //
  // The handler lives in a ref, and the listener is registered once: the
  // alternative is re-subscribing on every keystroke of the topic box, which
  // is also the render that would make a stale closure most likely. The ref is
  // refreshed after every render, so it always closes over the current
  // selection without the listener ever being replaced.
  //
  // Shift is the modifier for everything that changes the deck. Plain
  // Cmd/Ctrl/Alt combinations are left alone on purpose — Cmd+D is a bookmark
  // and Alt+Arrow changes tabs — so no shortcut here shadows a browser one, and
  // nothing fires while the caret is in a field (the topic box, the slide
  // editor, or a search input).
  // ---------------------------------------------------------------------------
  const shortcutHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  const onShortcut = (event: KeyboardEvent) => {
    if (!deckId || slides.length === 0) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

    if (viewerOpen || busy || slideBusy || rewriting || saving || imageBusy !== null) return;
    // A held key should not walk a slide across the deck.
    if (event.repeat) return;

    const last = slides.length - 1;
    const key = event.key;

    if (key === "ArrowLeft" || key === "ArrowRight") {
      const step = key === "ArrowLeft" ? -1 : 1;
      if (event.shiftKey) {
        const to = selected + step;
        if (to < 0 || to > last) return;
        event.preventDefault();
        void restructure(() => moveSlideAction({ deckId, from: selected, to }), to);
        return;
      }
      const next = selected + step;
      if (next < 0 || next > last) return;
      event.preventDefault();
      setSelected(next);
      setEditDraft(null);
      return;
    }

    if (key === "ArrowUp" || key === "ArrowDown") {
      if (!event.shiftKey) return;
      const to = selected + (key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to > last) return;
      event.preventDefault();
      void restructure(() => moveSlideAction({ deckId, from: selected, to }), to);
      return;
    }

    if (key === "Enter" && event.shiftKey) {
      event.preventDefault();
      void restructure(() => addSlideAction({ deckId, after: selected }), selected + 1);
      return;
    }

    if ((key === "d" || key === "D") && event.shiftKey) {
      event.preventDefault();
      void restructure(() => duplicateSlideAction({ deckId, index: selected }), selected + 1);
      return;
    }

    if (key === "Delete" && event.shiftKey) {
      if (slides.length <= 1) return;
      event.preventDefault();
      void restructure(() => removeSlideAction({ deckId, index: selected }), selected - 1);
    }
  };

  // Refreshed after every render (no dependency list) so the single listener
  // mounted below always calls the closure over the current selection.
  useEffect(() => {
    shortcutHandler.current = onShortcut;
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

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

  const openViewer = async () => {
    if (!spec || viewing || slides.length === 0) return;
    setViewing(true);
    try {
      const bytes = await buildPptx(spec);
      const name = deckFileName(spec.title);
      const opened = await openOfficeFile(name, bytes);
      if (viewerFile) disposeOpenedFile(viewerFile);
      setViewerFile(opened);
      setViewerSource({ name, bytes });
      setViewerOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the file to view.");
    } finally {
      setViewing(false);
    }
  };

  const current = slides[Math.min(selected, Math.max(0, slides.length - 1))];
  const activeTheme = deck ? themeById(deck.theme) : themeById(theme);
  // `research` is stored as `v.any()`, so the panel reads it defensively: an
  // old deck has no field, and a half-written one could hold anything.
  const research = deck?.research as { facts?: unknown; sources?: unknown } | undefined;
  const researchFacts = Array.isArray(research?.facts)
    ? (research.facts as unknown[]).filter((fact): fact is string => typeof fact === "string")
    : [];
  const researchSources = Array.isArray(research?.sources)
    ? (research.sources as { title?: unknown; url?: unknown }[])
        .filter((source) => typeof source?.url === "string")
        .map((source) => ({
          title: typeof source.title === "string" ? source.title : String(source.url),
          url: source.url as string,
        }))
    : [];
  const researchCount = researchFacts.length;

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

          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setShowTopics((open) => !open)}
              aria-expanded={showTopics}
              className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              Topics
            </button>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                maxLength={400}
                placeholder="Audience (optional)"
                className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50"
              />
              <input
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                maxLength={400}
                placeholder="Tone (optional)"
                className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50"
              />
          </div>

          {showTopics && (
            <div className="mt-2 max-h-[32vh] overflow-y-auto rounded-lg border border-border/60 bg-muted/30 p-2">
              <p className="px-1 pb-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                What do you want to understand?
              </p>
              <div className="flex flex-col gap-1.5">
                {DECK_TOPICS.map((t) => (
                  <button
                    key={t.title}
                    type="button"
                    onClick={() => {
                      setTopic(t.title);
                      onTopicSelect(t);
                      setShowTopics(false);
                      void run(t.title);
                    }}
                    disabled={busy}
                    className="rounded border border-border/60 px-2 py-1.5 text-left text-xs transition-colors hover:border-foreground/30 hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
                  >
                    <div className="font-medium">{t.title}</div>
                    <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{t.pitch}</div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground/60">{t.audience}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

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

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStudentMode((value) => !value)}
              aria-pressed={studentMode}
              title="Write for a learner: define every term, show a worked example per idea, name the misconceptions, and end with a practice question"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                studentMode
                  ? "border-foreground/30 bg-accent text-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-accent/50"
              }`}
            >
              <BookOpen className="size-3" /> Student lesson
            </button>
            <span className="text-[10px] text-muted-foreground/70">
              {studentMode
                ? "definitions · worked examples · misconceptions · practice question"
                : "written for a general audience"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setWithResearch((value) => !value)}
              title="Search the web first, then write the slides against what it found"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                withResearch
                  ? "border-foreground/30 bg-accent text-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-accent/50"
              }`}
              aria-pressed={withResearch}
            >
              <Globe className="size-3" /> Web research
            </button>
            <span className="text-[10px] text-muted-foreground/70">
              {withResearch
                ? "one live search — slides quote its facts and credit its sources"
                : "the model writes alone, with no sources"}
            </span>
          </div>

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
            {deck && slides.some((slide) => slide.kind === "image" && !slide.image?.dataUrl) ? (
              <button
                onClick={() => void fillImageSlides()}
                disabled={imageBusy !== null || busy}
                title="Search the web for a picture for every image slide"
                className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {imageBusy !== null ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
                Pictures
              </button>
            ) : null}
            {deck && slides.length > 0 ? (
              <>
                <button
                  onClick={() => void openViewer()}
                  disabled={viewing}
                  title="Read the packaged .pptx in the viewer"
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
                >
                  {viewing ? <Loader2 className="size-3 animate-spin" /> : <Eye className="size-3" />}
                  {viewing ? "Opening…" : "View"}
                </button>
                <button
                  onClick={() => void download()}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
                >
                  {downloading ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                  {downloading ? "Packaging…" : "Download .pptx"}
                </button>
              </>
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
              {researchCount ? ` · ${researchCount} researched facts` : ""}
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

          {/* What the writer was told. The facts are the deck's evidence, so
              they stay visible after the build instead of living only in the
              prompt — including the sources, which nothing on the slides
              names unless a sources slide is added. */}
          {researchFacts.length > 0 ? (
            <details className="mt-2 rounded border border-border/60 p-2">
              <summary className="cursor-pointer text-[9px] uppercase tracking-widest text-muted-foreground/60">
                Research · {researchFacts.length} facts · {researchSources.length} sources
              </summary>
              <ul className="mt-1 space-y-1">
                {researchFacts.slice(0, 8).map((fact, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-muted-foreground">
                    · {fact}
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {researchSources.slice(0, 6).map((source) => (
                  <a
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] underline underline-offset-2 hover:text-foreground"
                    title={source.title}
                  >
                    {source.url.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0]}
                  </a>
                ))}
                {deckId ? (
                  <button
                    onClick={() => void restructure(() => sourcesSlideAction({ deckId }))}
                    disabled={slideBusy}
                    title="Add one slide crediting every source"
                    className="ml-auto inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    <Plus className="size-2.5" /> Sources slide
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>

        {/* Previews */}
        {slides.length > 0 ? (
          <>
            <p className="mt-2 text-[9px] text-muted-foreground/60">
              Drag a thumbnail to reorder · ← → choose · Shift+↑↓ move · Shift+Enter add · Shift+D duplicate · Shift+Del delete
            </p>

            <div className="mt-1 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {slides.map((slide, index) => (
                // The drag lives on a wrapper, not on the button: Firefox will
                // not start an HTML5 drag from a `<button>`, while it happily
                // drags a div that wraps one. The button keeps every bit of its
                // own behaviour — click to select, focus ring, keyboard.
                <div
                  key={index}
                  draggable={!busy && !slideBusy && imageBusy === null}
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    // Some browsers refuse to start a drag without data.
                    event.dataTransfer.setData("text/plain", String(index));
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOver(null);
                  }}
                  onDragOver={(event) => {
                    if (dragIndex === null || dragIndex === index) return;
                    // Only a prevented dragover marks the tile as a drop target.
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOver(index);
                  }}
                  onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData("text/plain");
                    const from = dragIndex ?? (raw ? Number(raw) : -1);
                    dropOn(from, index);
                  }}
                  title={`Slide ${index + 1} — drag to reorder`}
                  className={dragIndex === index ? "cursor-grabbing opacity-40" : ""}
                >
                  <button
                    onClick={() => {
                      setSelected(index);
                      setEditDraft(null);
                    }}
                    className={`group relative aspect-video w-full overflow-hidden rounded-md border text-left transition-all ${
                      dragOver === index
                        ? "border-primary ring-2 ring-primary/50"
                        : index === selected
                          ? "border-primary/60 ring-1 ring-primary/30"
                          : "border-border/60 hover:border-foreground/30"
                    }`}
                  >
                    <SlideThumb slide={slide} themeId={deck?.theme ?? theme} index={index} />
                  </button>
                </div>
              ))}
            </div>

            {editDraft ? (
              <div className="mt-2 rounded-lg border border-border/60 p-2">
                <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                  <Pencil className="size-3" /> Editing slide {selected + 1}
                </div>
                <input
                  value={editDraft.title}
                  onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                  placeholder="Slide title"
                  aria-label="Slide title"
                  className="w-full rounded border border-border/60 bg-transparent px-1.5 py-1 text-xs outline-none focus:border-foreground/30"
                />
                <input
                  value={editDraft.subtitle}
                  onChange={(e) => setEditDraft({ ...editDraft, subtitle: e.target.value })}
                  placeholder="Subtitle (optional)"
                  aria-label="Slide subtitle"
                  className="mt-1 w-full rounded border border-border/60 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-foreground/30"
                />
                <textarea
                  value={editDraft.body}
                  onChange={(e) => setEditDraft({ ...editDraft, body: e.target.value })}
                  rows={4}
                  placeholder="One bullet per line — used by bullet and agenda slides"
                  aria-label="Slide bullets"
                  className="mt-1 w-full resize-y rounded border border-border/60 bg-transparent px-1.5 py-1 text-[11px] leading-relaxed outline-none focus:border-foreground/30"
                />
                <textarea
                  value={editDraft.notes}
                  onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                  rows={3}
                  placeholder="Speaker notes"
                  aria-label="Slide notes"
                  className="mt-1 w-full resize-y rounded border border-border/60 bg-transparent px-1.5 py-1 text-[11px] leading-relaxed outline-none focus:border-foreground/30"
                />
                <div className="mt-1 flex flex-wrap gap-1">
                  {QUICK_REWRITES.map((quick) => (
                    <button
                      key={quick.label}
                      onClick={() => setRewriteHint(quick.hint)}
                      disabled={rewriting}
                      title={quick.hint}
                      className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {quick.label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    value={rewriteHint}
                    onChange={(e) => setRewriteHint(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void rewriteCurrent();
                    }}
                    placeholder="Ask AI to change it: shorter, add a number, less corporate…"
                    aria-label="Instruction for the AI rewrite"
                    className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-foreground/30"
                  />
                  <button
                    onClick={() => void rewriteCurrent()}
                    disabled={rewriting || saving}
                    className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {rewriting ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                    {rewriting ? "Rewriting…" : "Rewrite"}
                  </button>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => void saveEdit()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <Pencil className="size-3" />}
                    Save slide
                  </button>
                  <button
                    onClick={() => setEditDraft(null)}
                    className="rounded px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <span className="ml-auto text-[10px] text-muted-foreground/60">the download updates</span>
                </div>
              </div>
            ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-lg border border-border/60 p-2">
                <div className="mb-1 flex flex-wrap items-center gap-1">
                  <button
                    onClick={() => moveCurrent(-1)}
                    disabled={selected === 0 || slideBusy}
                    title="Move this slide earlier"
                    aria-label="Move slide earlier"
                    className="rounded border border-border/60 p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowLeft className="size-3" />
                  </button>
                  <button
                    onClick={() => moveCurrent(1)}
                    disabled={selected >= slides.length - 1 || slideBusy}
                    title="Move this slide later"
                    aria-label="Move slide later"
                    className="rounded border border-border/60 p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowRight className="size-3" />
                  </button>
                  <button
                    onClick={() => void restructure(() => duplicateSlideAction({ deckId: deckId!, index: selected }), selected + 1)}
                    disabled={slideBusy || !deckId}
                    title="Duplicate this slide"
                    aria-label="Duplicate slide"
                    className="rounded border border-border/60 p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <Copy className="size-3" />
                  </button>
                  <button
                    onClick={() => void restructure(() => removeSlideAction({ deckId: deckId!, index: selected }), selected - 1)}
                    disabled={slideBusy || !deckId || slides.length <= 1}
                    title="Delete this slide"
                    aria-label="Delete slide"
                    className="rounded border border-border/60 p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="size-3" />
                  </button>
                  <button
                    onClick={() => void restructure(() => addSlideAction({ deckId: deckId!, after: selected }), selected + 1)}
                    disabled={slideBusy || !deckId}
                    title="Add a slide after this one"
                    className="ml-auto inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-30"
                  >
                    <Plus className="size-2.5" /> Add slide
                  </button>
                </div>
                <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
                  <ChevronRight className="size-3" /> Slide {selected + 1} · {current?.kind}
                  <button
                    onClick={() => current && startEdit(current)}
                    className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] normal-case tracking-normal transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-2.5" /> Edit
                  </button>
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
                {current?.kind === "image" ? (
                  <div className="mt-1.5 rounded border border-border/60 p-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={imageHint}
                        onChange={(e) => setImageHint(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void findImage(selected);
                        }}
                        maxLength={160}
                        placeholder="Picture to search for (optional)"
                        aria-label="Picture search query"
                        className="min-w-0 flex-1 rounded border border-border/60 bg-transparent px-1.5 py-1 text-[10px] outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
                      />
                      <button
                        onClick={() => void findImage(selected)}
                        disabled={imageBusy !== null}
                        title="Find a web picture and put it on this slide"
                        className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        {imageBusy === selected ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <ImagePlus className="size-3" />
                        )}
                        {imageBusy === selected ? "Searching…" : "Web image"}
                      </button>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                      {current.image?.dataUrl
                        ? current.image.caption || "Picture attached."
                        : "Placeholder — search the web, or leave it for the template."}
                    </p>
                  </div>
                ) : null}
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
            )}
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

        {/* Brand template — PowerPoint Generator API */}
        {deck && slides.length > 0 ? (
          <div className="mt-3 rounded-lg border border-border/60 p-2">
            <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/60">
              <FileJson className="size-3" /> Brand template · PowerPoint Generator
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Pour this deck into your own .pptx. Put {`{{title}}`}, {`{{body_1}}`} … in the template&apos;s text
              boxes; one template slide is repeated for every slide here, so the layout stays yours.
            </p>
            {/* Verified against the live service: the free plan stamps that
                footer onto every slide. Saying so here beats letting someone
                find it in a client-facing deck. */}
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
              The service&apos;s free plan adds a “Free version” footer to each rendered slide — that
              comes from them, not from the template.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                id="deck-template-file"
                type="file"
                accept=".pptx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadTemplate(file);
                }}
              />
              <label
                htmlFor="deck-template-file"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-[10px] transition-colors hover:bg-accent"
              >
                {templateBusy ? <Loader2 className="size-3 animate-spin" /> : <Presentation className="size-3" />}
                {template ? template.name.slice(0, 28) : "Choose .pptx"}
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                layout
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={templateIndex}
                  onChange={(e) => setTemplateIndex(Math.max(0, Number(e.target.value) || 0))}
                  className="w-12 rounded border border-border/60 bg-transparent px-1 py-0.5 text-[10px] outline-none"
                  aria-label="Template slide index"
                />
              </label>
              <button
                onClick={() => void renderInto()}
                disabled={!template || templateBusy || !finished}
                className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                {templateBusy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                Render into template
              </button>
              {rendered?.url ? (
                <a
                  href={rendered.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] underline underline-offset-2 hover:text-foreground"
                >
                  Download {rendered.slides} slides · {Math.round(rendered.bytes / 1024)} KB
                </a>
              ) : null}
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-muted-foreground/70">Tags the template can use</summary>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {`{{title}} {{kicker}} {{subtitle}} {{body}} {{body_1}}–{{body_6}} {{notes}} {{index}} {{total}} {{number}} {{kind}} {{quote}} {{quote_author}} {{qr_url}} {{qr_label}} {{metric_1_value}} {{metric_1_label}} … {{cell_r_c}} — plus deck-level {{deck_title}} {{deck_subtitle}} {{deck_author}} {{deck_footer}} {{deck_slides}}.`}
              </p>
            </details>
          </div>
        ) : null}

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

      <FileViewer
        open={viewerOpen}
        onOpenChange={(next) => {
          setViewerOpen(next);
          if (!next && viewerFile) {
            disposeOpenedFile(viewerFile);
            setViewerFile(null);
            setViewerSource(null);
          }
        }}
        initial={viewerFile}
        initialSource={viewerSource}
        onSendToStudio={onSendToStudio}
      />
    </motion.div>
  );
}
