// ---------------------------------------------------------------------------
// Image Studio — the dedicated place to make pictures, or to find real ones.
//
// Two modes exist because they are two different requests that look alike:
//
//   • Web    — "photos of the northern lights" asks for pictures that already
//              exist. Nothing is generated; the search engine returns real
//              images from real sites, and the AI's only job is to compare the
//              candidates and say which one is the right picture.
//   • AI     — "generate a poster for a jazz night" asks for something that
//              does not exist yet, so the prompt goes to the provider chain
//              with a style, a shape and any extra instructions.
//
// Auto picks between them with the same rule the chat uses: a creation verb
// means AI, everything shaped like "photos of X" means the web. A special
// prompt ("draw", "render", "create an image") is therefore always AI.
//
// Whatever the mode, a result is never a link out. Web pictures open in the
// in-app viewer on click and are saved with the download button on the
// picture — never by navigating to the page that hosts them, which is the
// behaviour `<a href={pageUrl}>` gives and nobody asked for.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Lightbox } from "@/components/lightbox";
import { Button } from "@/components/ui/button";
import { OwnImageServer } from "@/components/own-image-server";
import { cn } from "@/lib/utils";
import { findWebImageQuery } from "@/lib/web-images";
import { composeGroundedPrompt } from "@/lib/character-look";
import { isPageUrl } from "@/lib/page-brief";
import { downloadImage, imageFileName } from "@/lib/download-image";
import {
  Brain,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  ImagePlus,
  Loader2,
  RotateCcw,
  Search,
  RefreshCw,
  Send,
  Shuffle,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  UserRound,
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

/** One real picture found on a real site. */
export interface StudioCandidate {
  url: string;
  source: string;
  title?: string;
  pageUrl?: string;
  width?: number;
  height?: number;
}

export interface StudioSearchResult {
  images: StudioCandidate[];
  /** The AI's choice. `matched: false` means it found nothing close enough. */
  pick: {
    url: string;
    reason: string;
    model: string | null;
    matched?: boolean;
  } | null;
  reason: string | null;
}

/** `auto` decides from the prompt; the other two are the user overriding it. */
type StudioMode = "auto" | "web" | "ai";

interface HistoryEntry {
  kind: "ai" | "web";
  url: string;
  prompt: string;
  at: number;
  publicId?: string;
  provider?: string;
  /** Web entries: the site the picture came from, and its page. */
  source?: string;
  title?: string;
  pageUrl?: string;
  candidates?: StudioCandidate[];
  pickReason?: string;
  pickModel?: string | null;
  model?: StudioModel;
  aspect?: StudioAspect;
  instructions?: string;
  avoid?: string;
  /** The character reference the prompt was grounded with, for transparency. */
  reference?: string;
  /** The page whose description grounded the prompt, if any. */
  page?: StudioPage;
  /** The picture this one was varied from, so "Again" varies the same way. */
  base?: { url: string; strength: number };
  /** Pinned pictures survive the 12-entry cap. */
  pinned?: boolean;
  /**
   * Found because Generate looked on the web before drawing. Only these offer
   * "Draw instead": an ordinary web search is already what the user asked for.
   */
  foundFirst?: boolean;
}

/** A page read as a visual reference: what it is, and how it looks. */
export interface StudioPage {
  url: string;
  title: string;
  brief: string;
  source: string;
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
    /** Present means "variation": the picture to start from. */
    sourceImage?: string;
    /** 0.05–1: how far the variation may drift from that picture. */
    strength?: number;
  }) => Promise<StudioResult>;
  /** Real images from the web, with the AI's pick if it was asked for one. */
  search: (input: {
    query: string;
    decide: boolean;
    /** Ask "is this picture really out there?" rather than "which is best?". */
    requireMatch?: boolean;
  }) => Promise<StudioSearchResult>;
  /**
   * Rewrites a rough description into a detailed prompt. `changed: false`
   * means the rewrite failed or came back identical, so the UI can say so
   * instead of pretending the button did something.
   */
  enhance: (input: {
    prompt: string;
    style?: string;
    instructions?: string;
    avoid?: string;
  }) => Promise<{ prompt: string; model: string | null; changed: boolean }>;
  /**
   * Researches the characters named in a prompt: which ones they are, what
   * they look like, and their newest form. An empty `brief` means the prompt
   * names nobody (or the lookup failed), and generation carries on unchanged.
   */
  lookup: (input: { prompt: string; refresh?: boolean }) => Promise<{
    brief: string;
    names: string[];
    sources: { title: string; url: string }[];
    model: string | null;
    cached: boolean;
  }>;
  /**
   * Reads a page and condenses it into a visual description — the studio's way
   * of drawing something the model has never seen, from a reference the user
   * already has. Optional: without it the control simply is not shown.
   */
  readPage?: (input: { url: string }) => Promise<StudioPage>;
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
 * How far a variation may drift. The numbers are the generators' own
 * `strength` dial — low keeps the source, high redraws it — so the labels
 * describe the effect rather than exposing a slider nobody can calibrate.
 */
const STRENGTHS: { id: number; label: string; hint: string }[] = [
  { id: 0.35, label: "Subtle", hint: "Same picture, finer details changed" },
  { id: 0.6, label: "Balanced", hint: "Same subject, a new take" },
  { id: 0.85, label: "Bold", hint: "Same idea, redrawn" },
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

const MODES: { id: StudioMode; label: string; hint: string; icon: typeof Globe }[] = [
  { id: "auto", label: "Auto", hint: "Read the prompt", icon: Sparkles },
  { id: "web", label: "Web", hint: "Real photos, no AI", icon: Globe },
  { id: "ai", label: "AI art", hint: "Generate a new image", icon: Wand2 },
];

const HISTORY_KEY = "jarvis-image-studio-v2";
/** Whether named characters are researched before drawing. On unless turned off. */
const LOOKUPS_KEY = "jarvis-image-lookups";
const HISTORY_LIMIT = 12;
/** Long enough for a direction, short enough not to become a second prompt. */
const NOTE_LIMIT = 220;

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
        ((e as HistoryEntry).kind === "ai" || (e as HistoryEntry).kind === "web") &&
        typeof (e as HistoryEntry).url === "string" &&
        typeof (e as HistoryEntry).prompt === "string",
    );
  } catch {
    return [];
  }
}

/** Trim and cap a free-text instruction without splitting a word in half. */
function note(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= NOTE_LIMIT) return text;
  return `${text.slice(0, NOTE_LIMIT).replace(/\s+\S*$/, "")}…`;
}

export function ImageStudio({
  open,
  onOpenChange,
  generate,
  search,
  enhance,
  lookup,
  readPage,
  onUseInChat,
}: ImageStudioProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<StudioMode>("auto");
  const [styleId, setStyleId] = useState("none");
  const [model, setModel] = useState<StudioModel>("default");
  const [aspect, setAspect] = useState<StudioAspect>("1:1");
  const [instructions, setInstructions] = useState("");
  const [avoid, setAvoid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ urls: string[]; index: number } | null>(null);
  const [polishing, setPolishing] = useState(false);
  // The wording the rewrite replaced, so "Undo" is one click rather than
  // retyping what the user had already written.
  const [sharpenedFrom, setSharpenedFrom] = useState<string | null>(null);
  const [sharpenNote, setSharpenNote] = useState<string | null>(null);
  // Character grounding is on by default: naming a character is a request for
  // that character, and without a reference the generator invents its own.
  // A page read is deliberately not part of the request: it is a reference the
  // user brings, so it persists across renders until they clear it.
  const [page, setPage] = useState<StudioPage | null>(null);
  const [pageUrl, setPageUrl] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [readingPage, setReadingPage] = useState(false);

  // The picture a variation starts from. Deliberately not cleared by a render:
  // the point of a variation is to keep drifting from the same source.
  const [source, setSource] = useState<{ url: string; strength: number } | null>(
    null,
  );

  const [lookups, setLookups] = useState(() => {
    try {
      return localStorage.getItem(LOOKUPS_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [lookStage, setLookStage] = useState<string | null>(null);
  const [reference, setReference] = useState<{
    names: string[];
    brief: string;
    sources: { title: string; url: string }[];
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // History is browser-local, so it is read on open rather than at mount:
  // a tab can stay alive across another tab's generations. Done while
  // rendering on the open transition (React's documented "adjust state when a
  // prop changes" pattern) instead of in an effect, which would render once
  // with the previous session's list and then immediately re-render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setHistory(loadHistory());
    // The viewer is portaled outside the dialog, so it would outlive it.
    else setPreview(null);
  }

  // Focus the prompt when the studio opens — it is the only reason it was
  // opened, and the delay waits for the dialog's own focus trap to settle.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => textareaRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  // Escape closes the preview, not the whole studio underneath it. Caught in
  // the capture phase so the dialog's own Escape handler never sees the key:
  // without this, one press would dismiss the viewer and the panel together
  // and lose the reason the user opened it.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPreview(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [preview]);

  const persist = useCallback((entries: HistoryEntry[]) => {
    // Twelve slots is enough scrollback but not enough to keep a reference you
    // come back to, so a pin outlives the cap: overflow is dropped from the
    // oldest *unpinned* entry, which leaves the newest-first order intact.
    const kept = [...entries];
    const room = Math.max(HISTORY_LIMIT, kept.filter((e) => e.pinned).length);
    for (let i = kept.length - 1; i >= 0 && kept.length > room; i--) {
      if (kept[i].pinned) continue;
      kept.splice(i, 1);
    }
    setHistory(kept);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(kept));
    } catch {
      // A full or disabled storage must not block the session — the in-memory
      // copy still drives the UI for this visit.
    }
  }, []);

  const togglePin = useCallback(
    (url: string) => {
      persist(
        history.map((entry) =>
          entry.url === url ? { ...entry, pinned: !entry.pinned } : entry,
        ),
      );
    },
    [history, persist],
  );

  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];

  // The chat's own rule, reused verbatim so the two surfaces cannot disagree
  // about what "photos of X" means. Null means the sentence is a creation
  // request — the special prompts ("draw", "render", "make an image") land
  // here, and they belong to the generator.
  const webQuery = findWebImageQuery(prompt);
  // A variation has a source picture, and only generated images can be varied:
  // searching the web for a photo of "a variation" is not a thing anyone means.
  const resolved: "web" | "ai" = source
    ? "ai"
    : mode === "auto"
      ? webQuery
        ? "web"
        : "ai"
      : mode;

  /**
   * The prompt the generator receives: the description, the style, then the
   * user's own instructions and exclusions. Built once per render so the note
   * under the textarea can show exactly what will be sent.
   */
  const aiPrompt = (() => {
    const base = prompt.trim();
    if (!base) return "";
    const parts = [base];
    if (style.suffix) parts.push(style.suffix);
    const extra = note(instructions);
    if (extra) parts.push(extra);
    const banned = note(avoid);
    if (banned) parts.push(`avoid: ${banned}`);
    return parts.join(", ");
  })();

  const run = useCallback(
    async (override?: {
      prompt: string;
      model: StudioModel;
      aspect: StudioAspect;
      /** Skip the web check — the "Draw instead" path. */
      draw?: boolean;
    }) => {
      const basePrompt = (override?.prompt ?? prompt).trim();
      // A variation works without a prompt — "another take on this" is a
      // complete request once there is a picture to take it from.
      if ((!basePrompt && !source) || busy) return;
      const requestModel = override?.model ?? model;
      const requestAspect = override?.aspect ?? aspect;
      setBusy(true);
      setError(null);

      // Same decision as render-time, recomputed because this closure may run
      // long after the state it was created with.
      const query =
        override?.prompt !== undefined ? findWebImageQuery(basePrompt) : webQuery;
      const target: "web" | "ai" = source
        ? "ai"
        : mode === "auto"
          ? query
            ? "web"
            : "ai"
          : mode;

      try {
        if (target === "web") {
          const term = query ?? basePrompt;
          const found = await search({ query: term, decide: true });
          if (found.images.length === 0) {
            throw new Error(found.reason ?? "No images found on the web.");
          }
          // The action puts the AI's pick first, so index 0 is the choice.
          const best = found.images[0];
          const entry: HistoryEntry = {
            kind: "web",
            url: best.url,
            prompt: term,
            at: Date.now(),
            source: best.source,
            title: best.title,
            pageUrl: best.pageUrl,
            candidates: found.images,
            pickReason: found.pick?.reason,
            pickModel: found.pick?.model ?? null,
          };
          setCurrent(entry);
          setPreview(null);
          // A web picture was not drawn from a character reference, so the
          // note from the last render would be a lie about this one.
          setReference(null);
          persist([entry, ...history.filter((h) => h.url !== entry.url)]);
          return;
        }

        // Web first, before a credit is spent: "a red fox in snow" may already
        // be a photograph somebody published, and the real one is a better
        // answer than a drawing. Only Auto does this — choosing "AI art" is
        // itself the instruction to draw, and a stock photo back from that
        // button would be ignoring the user. Only an explicit match from the
        // comparison counts, and only for a bare prompt: the comparison judges
        // candidates from their metadata, so a style, an instruction, a page
        // or a reference picture is something it cannot confirm, and a photo
        // that ignores "in oil paint" is not the picture that was asked for.
        //
        // Pressing Generate a second time on a web-first result means "yes,
        // draw it" — handing back the same photograph again would read as a
        // broken button.
        const alreadyFound =
          current?.foundFirst === true &&
          current.prompt.trim().toLowerCase() === basePrompt.toLowerCase();
        const bareRequest =
          !override?.draw &&
          !alreadyFound &&
          mode === "auto" &&
          !source &&
          !page &&
          !note(instructions) &&
          !note(avoid) &&
          (style.id === "none" || style.id === "photo");
        if (bareRequest && basePrompt) {
          try {
            const found = await search({
              query: basePrompt,
              decide: true,
              requireMatch: true,
            });
            if (found.pick?.matched && found.images.length > 0) {
              const best = found.images[0];
              const entry: HistoryEntry = {
                kind: "web",
                url: best.url,
                prompt: basePrompt,
                at: Date.now(),
                source: best.source,
                title: best.title,
                pageUrl: best.pageUrl,
                candidates: found.images,
                pickReason: found.pick.reason,
                pickModel: found.pick.model ?? null,
                foundFirst: true,
              };
              setCurrent(entry);
              setPreview(null);
              setReference(null);
              persist([entry, ...history.filter((h) => h.url !== entry.url)]);
              return;
            }
          } catch (err) {
            // An optimisation, never a gate: a missing key, a spent quota or a
            // slow comparison must not cost the render it was meant to save.
            console.warn("[studio] web-first lookup failed:", err);
          }
        }

        // A named character needs their design in words before the generator
        // sees the prompt. The lookup returns an empty brief when the prompt
        // names nobody, which is the common case and costs one cheap call.
        let grounded =
          aiPrompt ||
          basePrompt ||
          (source ? "A new take on the reference image" : "");
        // Held in a local, not read back off state: `reference` is the value
        // from before this run, so the history entry would credit the wrong
        // description.
        let usedReference: string | undefined;
        if (lookups) {
          setLookStage("Checking for named characters…");
          try {
            const found = await lookup({ prompt: basePrompt });
            if (found.brief) {
              grounded = composeGroundedPrompt(grounded, found.brief);
              usedReference = found.brief;
              setReference({
                names: found.names,
                brief: found.brief,
                sources: found.sources,
              });
            } else {
              setReference(null);
            }
          } catch (err) {
            // A failed lookup must never cost the picture.
            console.warn("[studio] character lookup failed:", err);
            setReference(null);
          } finally {
            setLookStage(null);
          }
        }

        // A page reference is picked by hand, so it applies whether or not the
        // character lookup is on: it is how the user says "this exact design"
        // about something the model has never seen.
        const usedPage = page;
        if (usedPage) {
          grounded = `${grounded}\n\nPage reference (${usedPage.title}), keep this design recognisable: ${usedPage.brief}`;
        }

        // The instruction is prose as well as a parameter: the legs that take
        // an image read it as guidance, and the one that only takes words at
        // least describes what was asked for.
        const usedSource = source;
        if (usedSource) {
          grounded = `${grounded}\n\nVariation of the reference image: keep its subject, framing and palette; change what the prompt names.`;
        }

        const result = await generate({
          prompt: grounded,
          model: requestModel,
          aspectRatio: requestAspect,
          sourceImage: usedSource?.url,
          strength: usedSource?.strength,
        });
        const entry: HistoryEntry = {
          kind: "ai",
          ...result,
          prompt: basePrompt,
          model: requestModel,
          aspect: requestAspect,
          instructions: note(instructions) || undefined,
          avoid: note(avoid) || undefined,
          reference: usedReference,
          page: usedPage ?? undefined,
          base: usedSource ?? undefined,
          at: Date.now(),
        };
        setCurrent(entry);
        setPreview(null);
        persist([entry, ...history.filter((h) => h.url !== entry.url)]);
      } catch (err) {
        // The chain throws every stage's reason joined by newlines; keeping
        // the text verbatim is what makes the failure diagnosable.
        setError(err instanceof Error ? err.message : "Image generation failed.");
      } finally {
        setBusy(false);
      }
    },      [
      aiPrompt,
      aspect,
      avoid,
      busy,
      current,
      generate,
      history,
      instructions,
      lookup,
      lookups,
      mode,
      model,
      page,
      persist,
      prompt,
      search,
      source,
      style.id,
      webQuery,
    ],
  );

  /**
   * "a lighthouse" gets a lighthouse on white with no sky; the models are
   * literal. This is the paragraph people end up writing by hand, and the
   * previous wording is kept so undo costs one click.
   */
  const sharpen = useCallback(async () => {
    const base = prompt.trim();
    if (!base || polishing || busy) return;
    setPolishing(true);
    setSharpenNote(null);
    try {
      const result = await enhance({
        prompt: base,
        style: style.suffix || undefined,
        instructions: note(instructions) || undefined,
        avoid: note(avoid) || undefined,
      });
      if (!result.changed) {
        setSharpenNote(
          "Couldn't improve that one — a few more words gives the model something to work with.",
        );
        return;
      }
      setSharpenedFrom(prompt);
      setPrompt(result.prompt);
      setSharpenNote(
        result.model
          ? `Rewritten by ${result.model}. Undo keeps your wording.`
          : "Rewritten. Undo keeps your wording.",
      );
    } catch (err) {
      setSharpenNote(
        err instanceof Error ? err.message : "Couldn't rewrite that prompt.",
      );
    } finally {
      setPolishing(false);
    }
  }, [avoid, busy, enhance, instructions, polishing, prompt, style.suffix]);

  /**
   * Read a page as a visual reference.
   *
   * The brief lives beside the prompt, never inside it: the user's wording is
   * theirs, and a 600-character paragraph dropped into the textarea would be
   * impossible to edit back out. It is appended when the picture is drawn.
   */
  const readPageNow = useCallback(async () => {
    if (!readPage || readingPage) return;
    const url = pageUrl.trim();
    if (!isPageUrl(url)) {
      setPageError("That doesn't look like a web address.");
      return;
    }
    // A bare host is accepted in the box and completed here, so the server
    // never has to guess what "example.com/wiki" meant.
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    setReadingPage(true);
    setPageError(null);
    try {
      const found = await readPage({ url: full });
      setPage(found);
      setPageUrl(found.url);
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Couldn't read that page.",
      );
    } finally {
      setReadingPage(false);
    }
  }, [pageUrl, readPage, readingPage]);

  const unsharpen = useCallback(() => {
    if (sharpenedFrom === null) return;
    setPrompt(sharpenedFrom);
    setSharpenedFrom(null);
    setSharpenNote(null);
  }, [sharpenedFrom]);

  /**
   * Re-research a character on demand. Worth having: a character's newest form
   * only exists in articles written since the last lookup, and the cache is a
   * month old by design.
   */
  const refreshReference = useCallback(async () => {
    const base = prompt.trim();
    if (!reference || polishing || !base) return;
    setPolishing(true);
    setSharpenNote(null);
    try {
      const found = await lookup({ prompt: base, refresh: true });
      if (found.brief) {
        setReference({ names: found.names, brief: found.brief, sources: found.sources });
        setSharpenNote(
          found.names.length > 0
            ? `Updated from the web just now — press Generate to use it.`
            : null,
        );
      } else {
        setSharpenNote("Couldn't find a newer description just now.");
      }
    } catch (err) {
      setSharpenNote(
        err instanceof Error ? err.message : "Couldn't refresh the reference.",
      );
    } finally {
      setPolishing(false);
    }
  }, [lookup, polishing, prompt, reference]);

  const copyLink = useCallback(async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the link stays visible in the viewer's own
      // address bar, so there is nothing useful to replace it with.
    }
  }, [current]);

  const save = useCallback(
    (url: string, hint?: string) => {
      void downloadImage(url, imageFileName(url, hint ?? current?.prompt));
    },
    [current],
  );

  const alsoCompare = useCallback(async () => {
    if (!current || current.kind !== "web" || busy) return;
    setBusy(true);
    try {
      const found = await search({ query: current.prompt, decide: true });
      if (found.images.length === 0) {
        setError(found.reason ?? "No other images turned up.");
        return;
      }
      const best = found.images[0];
      const entry: HistoryEntry = {
        ...current,
        url: best.url,
        source: best.source,
        title: best.title,
        pageUrl: best.pageUrl,
        candidates: found.images,
        pickReason: found.pick?.reason,
        pickModel: found.pick?.model ?? null,
        at: Date.now(),
      };
      setCurrent(entry);
      persist([entry, ...history.filter((h) => h.url !== entry.url)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not compare again.");
    } finally {
      setBusy(false);
    }
  }, [busy, current, history, persist, search]);

  const removeEntry = useCallback(
    (url: string) => {
      const next = history.filter((h) => h.url !== url);
      persist(next);
      if (current?.url === url) setCurrent(next[0] ?? null);
    },
    [current, history, persist],
  );

  const previewUrls = current
    ? current.kind === "web" && current.candidates?.length
      ? current.candidates.map((c) => c.url)
      : [current.url]
    : [];

  // A web entry always has at least its own picture to show, even when the
  // stored candidate list is older than the shape that added it.
  const webCandidates: StudioCandidate[] =
    current?.kind === "web"
      ? (current.candidates?.length
          ? current.candidates
          : [{ url: current.url, source: current.source ?? "", title: current.title }])
      : [];

  const triggerLabel =
    resolved === "web" ? "Search photos" : mode === "auto" ? "Generate" : "Render";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] gap-3 overflow-y-auto p-4 sm:max-w-3xl sm:gap-4 sm:p-6"
        // The preview is portaled outside this dialog, so Radix sees every
        // click in it as an outside interaction and would dismiss the studio
        // — and the result being looked at — on the first arrow press.
        onInteractOutside={(e) => {
          if (preview) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="size-4" />
            Image Studio
          </DialogTitle>
          <DialogDescription className="pr-6 text-xs sm:text-sm">
            Real photos found on the web, a picture made from scratch, or a new
            take on one you already have. Results open in the viewer here — the
            download button saves the file itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4">
          {/* ---- Mode ---- */}
          <div>
            <div className="grid grid-cols-3 gap-1.5">
              {MODES.map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setMode(m.id);
                      // Web mode looks for real photos, which cannot be varied —
                      // keeping a source there would make the choice look
                      // ignored, since the AI path would still be running.
                      if (m.id === "web") setSource(null);
                    }}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors",
                      mode === m.id
                        ? "border-foreground/40 bg-accent text-foreground"
                        : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                    aria-pressed={mode === m.id}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <Icon className="size-3.5" />
                      {m.label}
                    </span>
                    <span className="text-[10px] leading-3 opacity-70">{m.hint}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              {mode === "auto" ? (
                webQuery ? (
                  <>
                    Auto reads this as <span className="text-foreground">a request for
                    real photos</span> of “{webQuery}” — no image is generated.
                  </>
                ) : (
                  <>
                    Auto reads this as <span className="text-foreground">a request to
                    make a picture</span> — but it checks the web for that exact
                    picture first, and only draws one when nothing real matches.
                    Phrases like “photos of X” go straight to the web.
                  </>
                )
              ) : resolved === "web" ? (
                <>Searching real images from across the web. Nothing is generated.</>
              ) : (
                <>
                  Drawing a new image with the provider chain — no web check,
                  since you asked to draw.
                </>
              )}
            </p>
          </div>

          {/* ---- Prompt ---- */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Prompt
              </span>
              {resolved === "ai" && (
                <div className="flex items-center gap-1.5">
                  {sharpenedFrom !== null && (
                    <button
                      type="button"
                      onClick={unsharpen}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <Undo2 className="size-3" />
                      Undo
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void sharpen()}
                    disabled={polishing || busy || !prompt.trim()}
                    title="Rewrite this into a more detailed prompt (uses the AI chain)"
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {polishing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Sparkles className="size-3" />
                    )}
                    {polishing ? "Sharpening…" : "Sharpen"}
                  </button>
                </div>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                // An edited prompt is no longer the rewrite: keeping "Undo"
                // would silently throw the edit away.
                setSharpenedFrom(null);
                setSharpenNote(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
              rows={3}
              placeholder={
                resolved === "web"
                  ? "photos of the northern lights over Tromsø, photos of a red panda…"
                  : "Describe the picture — a lighthouse in a storm, glass architecture, a fox in morning fog…"
              }
              // 16px on phones: anything smaller makes iOS zoom the whole sheet
              // in on focus and never zoom back out.
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:text-sm"
            />

            {sharpenNote && (
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                {sharpenNote}
              </p>
            )}

            {/* ---- Style presets (AI only: a style suffix means nothing to a
                web search, which returns what already exists) ---- */}
            {resolved === "ai" && (
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
            )}
          </div>

          {/* ---- Instructions (AI only) ---- */}
          {resolved === "ai" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Extra instructions
                </span>
                <input
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="from above, golden hour, wide shot"
                  maxLength={NOTE_LIMIT}
                  className="h-8 rounded-md border border-input bg-background px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Leave out
                </span>
                <input
                  value={avoid}
                  onChange={(e) => setAvoid(e.target.value)}
                  placeholder="text, watermarks, extra people"
                  maxLength={NOTE_LIMIT}
                  className="h-8 rounded-md border border-input bg-background px-2 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                />
              </label>
            </div>
          )}

          {/* ---- Model + shape + run ---- */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            {resolved === "ai" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Model preference
                </span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as StudioModel)}
                  className="h-8 w-full cursor-pointer rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[15rem]"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} — {m.note}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {resolved === "ai" && (
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
                        "h-8 flex-1 rounded-md border px-3 text-xs transition-colors sm:flex-none",
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
            )}

            <Button
              onClick={() => void run()}
              disabled={busy || (!prompt.trim() && !source)}
              className="h-9 w-full sm:ml-auto sm:h-8 sm:w-auto"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {resolved === "web"
                    ? "Searching…"
                    : lookStage
                      ? "Looking up…"
                      : "Rendering…"}
                </>
              ) : resolved === "web" ? (
                <>
                  <Search className="size-4" />
                  {triggerLabel}
                </>
              ) : (
                <>
                  <ImagePlus className="size-4" />
                  {triggerLabel}
                </>
              )}
            </Button>
          </div>

          {/* ---- Self-hosted endpoint (optional, collapsed) ---- */}
          <OwnImageServer />

          {resolved === "ai" && (
            <button
              type="button"
              role="switch"
              aria-checked={lookups}
              onClick={() => {
                const next = !lookups;
                setLookups(next);
                try {
                  localStorage.setItem(LOOKUPS_KEY, String(next));
                } catch {
                  // Private mode: the setting just lasts this visit.
                }
                if (!next) setReference(null);
              }}
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                lookups
                  ? "border-foreground/40 bg-accent text-foreground"
                  : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
              title="Looks up each named character's design and newest form before drawing"
            >
              <UserRound className="size-3" />
              Character looks {lookups ? "on" : "off"}
            </button>
          )}

          {/* ---- Variation source: a picture to start from. The dial decides
              how much of it survives; the prompt decides what changes. ---- */}
          {resolved === "ai" && source && (
            <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-muted/25 px-2.5 py-2">
              <img
                src={source.url}
                alt="Variation source"
                className="size-11 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                  <Shuffle className="size-3" />
                  Variation of this image
                </p>
                <div className="mt-1 flex items-center gap-1">
                  {STRENGTHS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setSource({ ...source, strength: s.id })
                      }
                      aria-pressed={source.strength === s.id}
                      title={s.hint}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        source.strength === s.id
                          ? "border-foreground/40 bg-accent text-foreground"
                          : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSource(null)}
                title="Start from scratch instead"
                className="shrink-0 self-start text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* ---- Page reference: draw this exact design, from a page the user
              already has. Off by default — it is something you bring. ---- */}
          {resolved === "ai" && readPage && (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  value={pageUrl}
                  onChange={(e) => {
                    setPageUrl(e.target.value);
                    setPageError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void readPageNow();
                    }
                  }}
                  placeholder="Ground on a page — paste a URL"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  // 16px on phones for the same reason as the prompt box.
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-xs"
                />
                <button
                  type="button"
                  onClick={() => void readPageNow()}
                  disabled={readingPage || !isPageUrl(pageUrl)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title="Read the page and describe what it shows"
                >
                  {readingPage ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Globe className="size-3" />
                  )}
                  {readingPage ? "Reading…" : "Read"}
                </button>
              </div>

              {pageError && (
                <p className="mt-1.5 text-[11px] leading-4 text-destructive">
                  {pageError}
                </p>
              )}

              {page && (
                <div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 truncate text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
                      title={page.url}
                    >
                      {page.title}
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setPage(null);
                        setPageUrl("");
                      }}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                      title="Stop grounding on this page"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {page.brief}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                    read via {page.source.replace("-", " ")}
                  </p>
                </div>
              )}
            </div>
          )}

          {resolved === "ai" && (style.suffix || instructions.trim() || avoid.trim()) && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              Sending: <span className="text-foreground/80">{aiPrompt}</span>
            </p>
          )}

          {/* The reference actually sent, so a wrong-looking result has an
              explanation on screen rather than being a mystery. */}
          {reference && (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  <UserRound className="size-3 shrink-0" />
                  <span className="truncate">
                    {reference.names.length > 0
                      ? reference.names.join(", ")
                      : "Character"}{" "}
                    reference
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void refreshReference()}
                  disabled={polishing}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
                  title="Look the character up again — new forms appear in new articles"
                >
                  <RefreshCw className={cn("size-3", polishing && "animate-spin")} />
                  Refresh
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                {reference.brief}
              </p>
              {reference.sources.length > 0 && (
                <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
                  From {reference.sources.map((s) => s.title).join(" · ")}
                </p>
              )}
            </div>
          )}

          {/* ---- Failure keeps every stage's reason, newline-separated ---- */}
          {error && (
            <div className="whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* ---- Result: AI render ---- */}
          {current && current.kind === "ai" && (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setPreview({ urls: [current.url], index: 0 })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPreview({ urls: [current.url], index: 0 });
                  }
                }}
                className="relative flex cursor-zoom-in items-center justify-center bg-muted/40"
                title="Preview full size"
              >
                <img
                  src={current.url}
                  alt={current.prompt}
                  className="max-h-[min(46vh,26rem)] w-full object-contain"
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  {current.provider ?? "image"}
                </span>
                {/* Download lives on the picture, upper region, always visible:
                    on a phone there is no hover to reveal it. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    save(current.url);
                  }}
                  title="Download this image"
                  className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-black/85"
                >
                  <Download className="size-3.5" />
                  Download
                </button>
              </div>
              {current.page && (
                <p className="border-t border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  Grounded on {current.page.title}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-background px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {current.prompt}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSource({
                      url: current.url,
                      strength: source?.strength ?? STRENGTHS[1].id,
                    })
                  }
                  title="Draw a variation of this picture"
                >
                  <Shuffle className="size-3.5" />
                  Vary
                </Button>
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
                <Button variant="outline" size="sm" onClick={() => save(current.url)}>
                  <Download className="size-3.5" />
                  Save
                </Button>
                <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onUseInChat(
                      {
                        url: current.url,
                        publicId: current.publicId ?? "",
                        provider: current.provider,
                      },
                      prompt.trim() || current.prompt,
                    );
                    onOpenChange(false);
                  }}
                >
                  <Send className="size-3.5" />
                  Use in chat
                </Button>
              </div>
            </div>
          )}

          {/* ---- Result: web photo comparison ---- */}
          {current && current.kind === "web" && (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                <Globe className="size-3" />
                {current.foundFirst
                  ? "Found on the web — nothing was drawn"
                  : `${current.candidates?.length ?? 1} real images from the web`}
                {current.pickModel ? (
                  <span className="ml-auto normal-case tracking-normal text-muted-foreground/80">
                    compared by {current.pickModel}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3">
                {webCandidates.map((c, i) => {
                  const isPick = c.url === current.url;
                  return (
                    <div
                      key={c.url + i}
                      className={cn(
                        "group relative overflow-hidden rounded-md border bg-muted/30",
                        isPick ? "border-primary/70" : "border-border/70",
                      )}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setPreview({ urls: previewUrls, index: i })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setPreview({ urls: previewUrls, index: i });
                          }
                        }}
                        className="block w-full cursor-zoom-in"
                        title={c.title ?? "Preview this image"}
                      >
                        <img
                          src={c.url}
                          alt={c.title ?? current.prompt}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      </div>

                      {isPick && (
                        <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                          <Brain className="size-2.5" />
                          AI pick
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => save(c.url)}
                        title="Download this image"
                        className="absolute right-1.5 top-1.5 z-10 flex size-7 items-center justify-center rounded-md bg-black/65 text-white transition-colors hover:bg-black/85"
                      >
                        <Download className="size-3.5" />
                      </button>

                      <p className="truncate bg-background/80 px-1.5 py-1 text-[10px] text-muted-foreground">
                        {c.source || "web"}
                        {c.width && c.height ? (
                          <span className="ml-1 opacity-60">
                            {c.width}×{c.height}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  );
                })}
              </div>

              {current.pickReason && (
                <p className="border-t border-border/70 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                  <span className="text-foreground">Why this one:</span>{" "}
                  {current.pickReason}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-background px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {current.prompt}
                </span>
                <Button variant="outline" size="sm" onClick={() => void alsoCompare()} disabled={busy}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="size-3.5" />
                  )}
                  Compare again
                </Button>
                {/* The way out of web-first: a real photo is only the right
                    answer until the user says they wanted a drawing. */}
                {current.foundFirst ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    title="Skip the web and render a new picture from this prompt"
                    onClick={() =>
                      void run({
                        prompt: current.prompt,
                        model,
                        aspect,
                        draw: true,
                      })
                    }
                  >
                    <Wand2 className="size-3.5" />
                    Draw instead
                  </Button>
                ) : null}
                <Button size="sm" onClick={() => save(current.url)}>
                  <Download className="size-3.5" />
                  Download
                </Button>
              </div>
            </div>
          )}

          {/* ---- History (this browser) ---- */}
          {history.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Recent — {history.length}
                </span>
                <button
                  type="button"
                  onClick={() => persist(history.filter((h) => h.pinned))}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-destructive"
                  title="Pinned pictures stay"
                >
                  {history.some((h) => h.pinned) ? "Clear unpinned" : "Clear all"}
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
                      onClick={() => {
                        setCurrent(h);
                        setReference(
                          h.reference
                            ? { names: [], brief: h.reference, sources: [] }
                            : null,
                        );
                        // A picture drawn from a page brings that page back
                        // with it, so "generate again" means the same design
                        // rather than the same words and a new invention.
                        setPage(h.page ?? null);
                        setPageUrl(h.page?.url ?? "");
                        setPageError(null);
                        setSource(h.base ?? null);
                      }}
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
                    <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                      {h.kind === "web" ? "web" : "ai"}
                    </span>
                    {/* Always visible on touch: there is no hover on a phone,
                        so a hover-only control is one nobody can press. */}
                    <button
                      type="button"
                      onClick={() => togglePin(h.url)}
                      title={h.pinned ? "Unpin" : "Pin — keeps it past 12 images"}
                      aria-pressed={!!h.pinned}
                      className={cn(
                        "absolute left-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 transition-opacity hover:bg-black/80 focus-visible:opacity-100",
                        h.pinned
                          ? "text-amber-300 opacity-100"
                          : "text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
                      )}
                    >
                      <Star
                        className={cn("size-3", h.pinned && "fill-current")}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEntry(h.url)}
                      title="Remove from history"
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-100 transition-opacity hover:bg-black/80 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
                Nothing yet — describe a picture, or ask for photos of something
                real, and press {resolved === "web" ? "Search" : "Generate"} (⌘↵).
              </p>
            </div>
          )}
        </div>
      </DialogContent>

      {/* The viewer is portaled to <body>: a modal dialog sets
          `pointer-events: none` on the body and re-enables it only inside its
          own content, so a preview rendered within the dialog would be visible
          and unclickable. `pointer-events-auto` puts it back in the chain. */}
      {preview && preview.urls.length > 0
        ? createPortal(
            <div className="pointer-events-auto">
              <Lightbox
                images={preview.urls}
                startIndex={preview.index}
                alt={current?.title ?? current?.prompt ?? "Image"}
                onDownload={(url) => save(url, current?.prompt)}
                onClose={() => setPreview(null)}
              />
            </div>,
            document.body,
          )
        : null}
    </Dialog>
  );
}
