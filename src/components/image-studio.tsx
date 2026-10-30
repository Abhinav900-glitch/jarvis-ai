// ---------------------------------------------------------------------------
// Image Studio — the dedicated place to make pictures.
//
// The chat already generates images (the /image command and the composer's
// Add menu), but it treats generation as a one-shot attachment: prompt in,
// picture in the transcript, nothing to steer and nothing kept. The studio is
// the workbench version of the same capability — style, model preference and
// shape are chosen before the request, and every result lands in a local
// history so a good render can be re-opened, downloaded or sent to the chat.
//
// It deliberately reuses the existing server chain through a callback rather
// than calling providers itself: `cloudinary.generateImage` is the one place
// that knows the provider order, the key handling and the rate-limit logic,
// and it is also the only leg that honours `model` and `aspectRatio`.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
  Wand2,
  X,
} from "lucide-react";

/** Model preference — mirrors the union `cloudinary.generateImage` accepts. */
export type StudioModel =
  | "default"
  | "flux"
  | "gpt-image-1"
  | "ideogram"
  | "recraft-20"
  | "recraft-20b"
  | "sd15"
  | "sdxl"
  | "nano-banana";

export type StudioAspect = "1:1" | "3:2" | "2:3";

export interface StudioResult {
  url: string;
  publicId: string;
  provider?: string;
}

interface HistoryEntry extends StudioResult {
  prompt: string;
  model: StudioModel;
  aspect: StudioAspect;
  at: number;
}

export interface ImageStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs the provider chain. Kept as a prop so the studio never learns the
   * provider order — and so it can be stubbed in tests.
   */
  generate: (input: {
    prompt: string;
    model: StudioModel;
    aspectRatio: StudioAspect;
  }) => Promise<StudioResult>;
  /** Hands the picture to the composer as a pending attachment. */
  onUseInChat: (image: StudioResult, prompt: string) => void;
}

const MODELS: { id: StudioModel; label: string; note: string }[] = [
  { id: "default", label: "Auto", note: "Let the chain pick" },
  { id: "flux", label: "Flux", note: "Best all-round detail" },
  { id: "gpt-image-1", label: "GPT Image", note: "Strong prompt following" },
  { id: "nano-banana", label: "Nano Banana", note: "Fast, natural light" },
  { id: "sdxl", label: "SDXL", note: "Wide style range" },
  { id: "sd15", label: "SD 1.5", note: "Fast, classic look" },
  { id: "ideogram", label: "Ideogram", note: "Text in images" },
  { id: "recraft-20", label: "Recraft", note: "Illustration & vectors" },
  { id: "recraft-20b", label: "Recraft 20B", note: "Illustration, finer" },
];

const ASPECTS: { id: StudioAspect; label: string; hint: string }[] = [
  { id: "1:1", label: "Square", hint: "1:1" },
  { id: "3:2", label: "Landscape", hint: "3:2" },
  { id: "2:3", label: "Portrait", hint: "2:3" },
];

/**
 * Style presets. They are appended to the prompt rather than sent as a
 * parameter, because every provider in the chain speaks only prose — a
 * separate "style" field would silently do nothing on the legs that ignore
 * `model`.
 */
const STYLES: { id: string; label: string; suffix: string }[] = [
  { id: "none", label: "No style", suffix: "" },
  {
    id: "photo",
    label: "Photoreal",
    suffix: "photorealistic, natural lighting, shallow depth of field, 85mm",
  },
  {
    id: "cinema",
    label: "Cinematic",
    suffix: "cinematic still, dramatic lighting, anamorphic, film grain",
  },
  {
    id: "3d",
    label: "3D render",
    suffix: "3D render, octane, soft global illumination, high detail",
  },
  {
    id: "anime",
    label: "Anime",
    suffix: "anime style, cel shading, clean line art, vibrant palette",
  },
  {
    id: "paint",
    label: "Painted",
    suffix: "oil painting, visible brushstrokes, gallery lighting",
  },
  {
    id: "neon",
    label: "Neon noir",
    suffix: "cyberpunk, neon reflections, rain-slick streets, moody",
  },
  {
    id: "iso",
    label: "Isometric",
    suffix: "isometric illustration, flat shading, crisp vector edges",
  },
  {
    id: "ink",
    label: "Line art",
    suffix: "minimal line art, black ink on white, no shading",
  },
];

const HISTORY_KEY = "jarvis-image-studio-v1";
const HISTORY_LIMIT = 12;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as HistoryEntry).url === "string" &&
        typeof (e as HistoryEntry).prompt === "string",
    );
  } catch {
    return [];
  }
}

export function ImageStudio({
  open,
  onOpenChange,
  generate,
  onUseInChat,
}: ImageStudioProps) {
  const [prompt, setPrompt] = useState("");
  const [styleId, setStyleId] = useState("none");
  const [model, setModel] = useState<StudioModel>("default");
  const [aspect, setAspect] = useState<StudioAspect>("1:1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // History is browser-local, so it is read on open rather than at mount:
  // a tab can stay alive across another tab's generations.
  useEffect(() => {
    if (open) setHistory(loadHistory());
  }, [open]);

  // Focus the prompt when the studio opens — it is the only reason it was
  // opened, and the delay waits for the dialog's own focus trap to settle.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  const persist = useCallback((entries: HistoryEntry[]) => {
    setHistory(entries);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
    } catch {
      // A full or disabled storage must not block the session — the in-memory
      // copy still drives the UI for this visit.
    }
  }, []);

  const effectivePrompt = (() => {
    const base = prompt.trim();
    const style = STYLES.find((s) => s.id === styleId);
    if (!base || !style?.suffix) return base;
    return `${base}, ${style.suffix}`;
  })();

  const run = useCallback(
    async (override?: { prompt: string; model: StudioModel; aspect: StudioAspect }) => {
      const requestPrompt = (override?.prompt ?? effectivePrompt).trim();
      if (!requestPrompt || busy) return;
      setBusy(true);
      setError(null);
      try {
        const result = await generate({
          prompt: requestPrompt,
          model: override?.model ?? model,
          aspectRatio: override?.aspect ?? aspect,
        });
        const entry: HistoryEntry = {
          ...result,
          prompt: requestPrompt,
          model: override?.model ?? model,
          aspect: override?.aspect ?? aspect,
          at: Date.now(),
        };
        setCurrent(entry);
        persist([entry, ...history.filter((h) => h.url !== entry.url)]);
      } catch (err) {
        // The chain throws every stage's reason joined by newlines; keeping
        // the text verbatim is what makes the failure diagnosable.
        setError(err instanceof Error ? err.message : "Image generation failed.");
      } finally {
        setBusy(false);
      }
    },
    [aspect, busy, effectivePrompt, generate, history, model, persist],
  );

  const copyLink = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the link stays visible in the address bar of
      // the opened image, so there is nothing useful to replace it with.
    }
  }, [current]);

  const removeEntry = useCallback(
    (url: string) => {
      const next = history.filter((h) => h.url !== url);
      persist(next);
      if (current?.url === url) setCurrent(next[0] ?? null);
    },
    [current, history, persist],
  );

  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="size-4" />
            Image Studio
          </DialogTitle>
          <DialogDescription>
            Style, model and shape before you render. Everything runs through the
            same free provider chain the chat uses, and results are kept in this
            browser.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ---- Prompt ---- */}
          <div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
              rows={3}
              placeholder="Describe the picture — a lighthouse in a storm, glass architecture, a fox in morning fog…"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            />

            {/* ---- Style presets ---- */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyleId(s.id)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    styleId === s.id
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                >
                  {s.id !== "none" && <Wand2 className="size-3" />}
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---- Model + shape ---- */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Model preference
              </span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as StudioModel)}
                className="h-8 max-w-[15rem] cursor-pointer rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Shape
              </span>
              <div className="flex gap-1">
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAspect(a.id)}
                    className={cn(
                      "h-8 rounded-md border px-3 text-xs transition-colors",
                      aspect === a.id
                        ? "border-foreground/40 bg-accent text-foreground"
                        : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                    title={`${a.label} (${a.hint})`}
                  >
                    {a.label}
                    <span className="ml-1.5 opacity-60">{a.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <Button
              onClick={() => void run()}
              disabled={busy || !prompt.trim()}
              className="ml-auto h-8"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Rendering…
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  Generate
                </>
              )}
            </Button>
          </div>

          {style.suffix && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              <span className="text-foreground">{style.label}</span> is appended
              as: <span className="italic">“{style.suffix}”</span>
            </p>
          )}

          {/* ---- Failure keeps every stage's reason, newline-separated ---- */}
          {error && (
            <div className="whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* ---- Result ---- */}
          {current && (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div className="relative bg-muted/40">
                <img
                  src={current.url}
                  alt={current.prompt}
                  className="max-h-[46vh] w-full object-contain"
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  {current.provider ?? "image"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-background px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {current.prompt}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void run()}
                  disabled={busy}
                  title="Render the same prompt again"
                >
                  <RotateCcw className="size-3.5" />
                  Again
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={current.url} download={`jarvis-image-${current.at}.png`} target="_blank" rel="noreferrer">
                    <Download className="size-3.5" />
                    Save
                  </a>
                </Button>
                <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onUseInChat(current, prompt.trim() || current.prompt);
                    onOpenChange(false);
                  }}
                >
                  <Send className="size-3.5" />
                  Use in chat
                </Button>
              </div>
            </div>
          )}

          {/* ---- History (this browser) ---- */}
          {history.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Recent renders — {history.length}
                </span>
                <button
                  type="button"
                  onClick={() => persist([])}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-destructive"
                >
                  Clear all
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {history.map((h) => (
                  <div
                    key={h.url}
                    className={cn(
                      "group relative overflow-hidden rounded-md border transition-colors",
                      current?.url === h.url
                        ? "border-foreground/50"
                        : "border-border/70 hover:border-foreground/30",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setCurrent(h)}
                      className="block w-full"
                      title={h.prompt}
                    >
                      <img
                        src={h.url}
                        alt={h.prompt}
                        loading="lazy"
                        className="aspect-square w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEntry(h.url)}
                      title="Remove from history"
                      className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 group-hover:flex"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length === 0 && !current && !busy && (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
              <X className="mx-auto size-4 text-muted-foreground/60" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nothing rendered yet — describe something above and press
                Generate (⌘↵).
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
