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
//
// The one exception is Bing Image Creator, and it is the opposite case: it has
// no API at all, so there is nothing to call. Its prompt link opens the site
// with the wording already in the box, and the picture it draws comes back by
// pasting its address — a hand-off rather than a render.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
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
import { BING_PROMPT_LIMIT, bingCreatorUrl } from "@/lib/bing-image";
import { composeGroundedPrompt } from "@/lib/character-look";
import { JUDGE_IDEA_LIMIT } from "@/lib/image-refine";
import { isPageUrl } from "@/lib/page-brief";
import { downloadImage, imageFileName, saveBlob } from "@/lib/download-image";
import {
  EXPORT_PRESETS,
  exportFileName,
  renderPreset,
  toBlob,
  type ExportPreset,
} from "@/lib/image-export";
import { zipFiles } from "@/lib/pptx/zip";
import {
  CloudinaryLibrary,
  type CloudinaryAsset,
} from "@/components/cloudinary-library";
import {
  Award,
  Brain,
  Check,
  CloudDownload,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  GitCompare,
  Globe,
  ImagePlus,
  Images,
  Loader2,
  RotateCcw,
  ScanEye,
  Search,
  RefreshCw,
  Send,
  Shuffle,
  Sparkles,
  Share2,
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

/** What a vision review says about one or more renders of the same prompt. */
export interface StudioReview {
  /** One entry per reviewed image, in the order they were sent. */
  entries: { url: string; score: number; verdict: string }[];
  /** The strongest one, chosen by the reviewer. */
  bestUrl: string | null;
  /** A prompt that fixes the best render's biggest flaw, when asked for one. */
  refinePrompt: string | null;
  model: string | null;
  /** Why no review came back, when none did. */
  reason: string | null;
}

/**
 * A long description of the picture, plus the compact prompt the image model
 * can actually read. The two are returned together so they cannot drift.
 */
export interface StudioPromptBrief {
  brief: string;
  prompt: string;
  words: number;
  model: string | null;
  reason: string | null;
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
  /** Set when this picture has a public link (`/s/<slug>`). */
  shareSlug?: string;
  /** The review score (0–100) this picture earned against the prompt. */
  score?: number;
  /** The reviewer's one-line verdict about this picture. */
  verdict?: string;
  /** Set when this picture was drawn as a refinement of `parent`. */
  refined?: boolean;
  /** The picture this one refines, so before/after is one click away. */
  parent?: string;
  /** The prompt the refinement pass used instead of the user's wording. */
  refinePrompt?: string;
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

/**
 * What the deployment knows about its Supabase project. Names and a host —
 * never the key, which is why this is safe to render.
 */
export interface StudioCloudStatus {
  configured: boolean;
  urlHost: string | null;
  /** Env var the secret came from, so a VITE_-prefixed one can be flagged. */
  keySource: string | null;
  table: string;
  warnings: string[];
}

/** One picture as it is sent to Postgres. */
export interface StudioCloudEntry {
  url: string;
  prompt: string;
  kind: string;
  provider?: string;
  aspect?: string;
  score?: number;
  refined?: boolean;
  pinned?: boolean;
  reference?: string;
  pageTitle?: string;
  createdAt: number;
}

/** One picture as it comes back from Postgres. */
export interface StudioCloudRow extends StudioCloudEntry {
  refined: boolean;
  pinned: boolean;
  /** Present when the row has a public link; absent when it was revoked. */
  shareSlug?: string;
}

export interface ImageStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * A picture to start from, handed in by another part of the app — the file
   * viewer sending an opened image here. Consumed on the open transition, not
   * on every render, so the strength the author picks is not reset.
   */
  seed?: { url: string; name?: string } | null;
  /**
   * Called when a generation actually used the seed's URL. The caller keeps
   * the uploaded blob when this fires and deletes it otherwise, so a studio
   * visit that never generated does not leave an orphan in storage.
   */
  onSourceUsed?: (url: string) => void;
  /**
   * Describes a picture so a seeded variation starts with real wording rather
   * than an empty prompt. Optional: without it the seed still loads as the
   * reference, it just arrives without a description.
   */
  describe?: (url: string) => Promise<{ prompt: string | null; reason: string | null }>;
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
   * Writes a ~500-word brief for the chosen image type, with no API key.
   *
   * The free text model does the writing. `brief` is shown and copyable;
   * `prompt` is the compact version the image model receives, because a
   * diffusion prompt is truncated long before 500 words.
   */
  promptBrief?: (input: {
    prompt: string;
    style?: string;
    instructions?: string;
    avoid?: string;
  }) => Promise<StudioPromptBrief>;
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
  /**
   * Reviews renders against the prompt: a score per picture, the best one, and
   * optionally a prompt that fixes the best one's biggest flaw. Optional —
   * without it the studio simply keeps the first take and offers no Refine.
   */
  judge?: (input: {
    prompt: string;
    images: string[];
    refine?: boolean;
  }) => Promise<StudioReview>;
  /**
   * Supabase, when the deployment has it configured: a copy of the history
   * that outlives this browser and can be read on another device. Optional —
   * without it the studio keeps history locally, as it always did.
   */
  cloud?: {
    status: () => Promise<StudioCloudStatus>;
    /** Whether the key works and the migration has been run. */
    check: () => Promise<{ ok: boolean; message: string | null }>;
    backup: (
      entries: StudioCloudEntry[],
    ) => Promise<{ saved: number; skipped: number; message: string | null }>;
    pull: () => Promise<{ entries: StudioCloudRow[]; message: string | null }>;
    /** Publish one picture behind a link that works signed out. */
    share: (
      entry: StudioCloudEntry,
    ) => Promise<{ slug: string | null; message: string | null }>;
    /** Retire that link. */
    unshare: (slug: string) => Promise<{ ok: boolean; message: string | null }>;
  };
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
 * How many pictures one press may draw. Four is the useful ceiling: enough to
 * choose from, few enough that the results still fit on screen and the cost of
 * a press stays predictable.
 */
const TAKE_COUNTS = [1, 2, 4] as const;

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
/** Whether takes are reviewed so the best one is kept. On unless turned off. */
const JUDGE_KEY = "jarvis-image-judge";
/** Whether a render is refined once more before it is offered. On by default. */
const REFINE_KEY = "jarvis-image-refine";
/**
 * How far a refinement may drift from the picture it is fixing. Low enough that
 * it is still the same picture: a high value would redraw the subject and lose
 * the composition the prompt was about, which is the opposite of a refinement.
 */
const REFINE_STRENGTH = 0.45;
/** A render this good has nothing a refine pass would improve. */
const GOOD_ENOUGH = 92;
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

/**
 * A history entry as a row payload, or null when it cannot be stored.
 *
 * Inline pictures are skipped rather than sent: a base64 image can be several
 * megabytes, and PostgREST rejects the request long before Postgres sees it.
 */
function cloudEntryOf(entry: HistoryEntry): StudioCloudEntry | null {
  if (!/^https?:\/\//i.test(entry.url)) return null;
  return {
    url: entry.url,
    prompt: entry.prompt,
    kind: entry.kind,
    provider: entry.provider,
    aspect: entry.aspect,
    score: entry.score,
    refined: entry.refined ?? false,
    pinned: entry.pinned ?? false,
    reference: entry.reference,
    pageTitle: entry.page?.title,
    createdAt: entry.at,
  };
}

/**
 * The same picture, back in the studio's own terms.
 *
 * The page a prompt was grounded on is not restored: only its title survives the
 * round trip, and half a reference is worse than none — regenerating from it
 * would invent the description it claims to keep.
 */
function historyFromCloud(row: StudioCloudRow): HistoryEntry {
  return {
    kind: row.kind === "web" ? "web" : "ai",
    url: row.url,
    prompt: row.prompt,
    at: row.createdAt,
    provider: row.provider,
    aspect: ASPECTS.some((a) => a.id === row.aspect)
      ? (row.aspect as StudioAspect)
      : undefined,
    score: row.score,
    refined: row.refined,
    pinned: row.pinned,
    reference: row.reference,
    shareSlug: row.shareSlug,
  };
}

/** The address a share slug opens, on whichever host the studio is served from. */
function shareUrlFor(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
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
  seed,
  onSourceUsed,
  describe,
  generate,
  search,
  enhance,
  promptBrief,
  lookup,
  readPage,
  judge,
  cloud,
  onUseInChat,
}: ImageStudioProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<StudioMode>("auto");
  const [styleId, setStyleId] = useState("none");
  const [model, setModel] = useState<StudioModel>("default");
  const [aspect, setAspect] = useState<StudioAspect>("1:1");
  const [takes, setTakes] = useState(1);
  // Every picture from the last press, so the ones that were not picked are
  // still there to look at. Session-only: history keeps the pick, not the set.
  const [takeList, setTakeList] = useState<HistoryEntry[]>([]);
  const [takeNote, setTakeNote] = useState<string | null>(null);
  // Which export size is being cropped right now, or "all" for the zip.
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
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
  // The 500-word brief, the wording it was written for, and the compact prompt
  // that was applied. Both wordings count as current: Undo returns to the
  // first, the rewrite is the second, and only a manual edit is stale.
  const [briefing, setBriefing] = useState(false);
  const [briefResult, setBriefResult] = useState<StudioPromptBrief | null>(null);
  const [briefFor, setBriefFor] = useState<string | null>(null);
  const [briefApplied, setBriefApplied] = useState<string | null>(null);
  const [briefCopied, setBriefCopied] = useState(false);
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
  // Which seed the current source came from, and whether it has been drawn
  // from. A seed that was never used is dropped on close, both here and in
  // storage, so the next visit does not start from a deleted URL.
  const [seededUrl, setSeededUrl] = useState<string | null>(null);
  const [seededUsed, setSeededUsed] = useState(false);
  // One description per seed. `describeFor` is the URL being described and
  // `describeResult` is what came back for it — keeping the URL in the result
  // is what lets a stale answer be ignored without an extra ref.
  const [describeFor, setDescribeFor] = useState<string | null>(null);
  const [describeResult, setDescribeResult] = useState<{
    for: string;
    prompt: string | null;
    reason: string | null;
    /** Whether it replaced an empty prompt or respected one already written. */
    filled: boolean;
  } | null>(null);
  // The dashboard passes an inline callback, so its identity changes on every
  // render; the ref keeps the effect from re-firing the description for that.
  const describeRef = useRef(describe);
  // The generation callback must not be rebuilt when the dashboard re-renders,
  // so the seed URL and the "used" callback are read through refs.
  const seededUrlRef = useRef(seededUrl);
  const onSourceUsedRef = useRef(onSourceUsed);
  const describing = describeFor !== null && describeResult?.for !== describeFor;
  const describeNote =
    describeResult && describeResult.for === describeFor
      ? describeResult.prompt
        ? describeResult.filled
          ? "Wrote a starting prompt from the image — edit it, then Generate."
          : "Reference loaded; your prompt was left as written."
        : describeResult.reason
      : null;

  const [lookups, setLookups] = useState(() => {
    try {
      return localStorage.getItem(LOOKUPS_KEY) !== "false";
    } catch {
      return true;
    }
  });
  // Reviewing is what makes "keep the best" a real choice, so it is on by
  // default; the refine pass costs one more render, which the chip says out
  // loud so turning it off is an informed decision rather than a discovery.
  const [autoJudge, setAutoJudge] = useState(() => {
    try {
      return localStorage.getItem(JUDGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [autoRefine, setAutoRefine] = useState(() => {
    try {
      return localStorage.getItem(REFINE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [judging, setJudging] = useState(false);
  const [refining, setRefining] = useState(false);
  const [judgeNote, setJudgeNote] = useState<string | null>(null);
  // Bing is a hand-off, not a leg: the link carries the prompt, and the picture
  // is brought back by pasting its address. Session-only — a link is not
  // history until the image it points at is.
  const [bingOpen, setBingOpen] = useState(false);
  const [bingLink, setBingLink] = useState("");
  const [bingError, setBingError] = useState<string | null>(null);
  // Whether the pre-filled address was just copied, for the button's label.
  const [bingCopied, setBingCopied] = useState(false);
  // The Supabase copy: what the deployment reports, what is stored there, and
  // which press is in flight. `null` status means it has not been asked yet.
  const [cloudStatus, setCloudStatus] = useState<StudioCloudStatus | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudRows, setCloudRows] = useState<StudioCloudRow[]>([]);
  const [cloudBusy, setCloudBusy] = useState<"backup" | "pull" | null>(null);
  const [cloudNote, setCloudNote] = useState<string | null>(null);
  // Sharing: one press creates the link (and copies it), the row under the
  // picture holds the obvious next actions.
  const [shareBusy, setShareBusy] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  // The gallery is a page of its own, so the dialog closes behind it rather
  // than stacking a second overlay on top of the studio.
  const navigate = useNavigate();
  const [lookStage, setLookStage] = useState<string | null>(null);
  /** Browsing the account's own Cloudinary media, not just this app's renders. */
  const [libraryOpen, setLibraryOpen] = useState(false);
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
    if (open) {
      setHistory(loadHistory());
      // A seed becomes the starting frame at the same moment, so the studio
      // opens already in variation mode with its reference visible. Strength
      // starts at Balanced; the author can change it before pressing Generate.
      if (seed) {
        setSource({ url: seed.url, strength: STRENGTHS[1].id });
        setSeededUrl(seed.url);
        setSeededUsed(false);
        setDescribeFor(seed.url);
        setDescribeResult(null);
      }
    } else {
      // The viewer is portaled outside the dialog, so it would outlive it.
      setPreview(null);
      // An unused seed is about to be deleted by the caller; holding its URL
      // as the next starting frame would mean generating from a 404.
      if (seededUrl && !seededUsed) {
        setSource((current) => (current?.url === seededUrl ? null : current));
      }
      setSeededUrl(null);
    }
  }

  useEffect(() => {
    describeRef.current = describe;
    seededUrlRef.current = seededUrl;
    onSourceUsedRef.current = onSourceUsed;
  });

  // A seeded image arrives with no prompt. Describing it turns "a variation of
  // something" into a sentence that names the subject, framing and light, which
  // is what a variation prompt needs to change one thing on purpose.
  //
  // The ref is the guard, not the dependency list: `describe` is an inline
  // callback in the dashboard and gets a new identity on every render there.
  useEffect(() => {
    if (!open) return;
    if (!describeFor || !describeRef.current) return;
    // Already answered for this seed, or a newer seed replaced it.
    if (describeResult?.for === describeFor) return;

    let cancelled = false;
    void describeRef
      .current(describeFor)
      .then((result) => {
        if (cancelled) return;
        // Only fill an empty box: a prompt the author already wrote is theirs.
        const written = textareaRef.current?.value ?? "";
        const filled = Boolean(result.prompt) && !written.trim();
        if (filled && result.prompt) setPrompt(result.prompt);
        setDescribeResult({
          for: describeFor,
          prompt: result.prompt,
          reason: result.reason,
          filled,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDescribeResult({
          for: describeFor,
          prompt: null,
          reason: "Could not describe that image; write the prompt yourself.",
          filled: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, describeFor, describeResult]);

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

  /**
   * Fold a review's scores onto the entries it reviewed, matched by URL.
   * Entries the reviewer did not score are returned untouched, so a missing
   * number never masquerades as a zero out of a hundred.
   */
  const annotate = useCallback(
    (entries: HistoryEntry[], review: StudioReview): HistoryEntry[] => {
      const byUrl = new Map(review.entries.map((entry) => [entry.url, entry]));
      return entries.map((entry) => {
        const found = byUrl.get(entry.url);
        if (!found || found.score <= 0) return entry;
        return {
          ...entry,
          score: found.score,
          verdict: found.verdict || undefined,
        };
      });
    },
    [],
  );

  /**
   * Draw one refined version of a picture: review it, then re-render from its
   * own bytes with the reviewer's suggested prompt at a low drift.
   *
   * The review is the point. A refinement planned without looking is just
   * another roll of the dice; the reviewer names the one flaw worth fixing, so
   * the second render is aimed at something specific.
   */
  const refineOnce = useCallback(
    async (
      entry: HistoryEntry,
      brief: string,
    ): Promise<HistoryEntry | null> => {
      if (!judge) return null;
      setRefining(true);
      setJudgeNote("Reviewing the picture…");
      try {
        const review = await judge({
          prompt: brief.slice(0, JUDGE_IDEA_LIMIT),
          images: [entry.url],
          refine: true,
        });
        const fix = review.refinePrompt?.trim();
        if (!fix || fix.length < 12) {
          setJudgeNote(
            review.reason ??
              "Nothing to fix — the review had no better prompt for this picture.",
          );
          return null;
        }
        setJudgeNote("Drawing the refined version…");
        const result = await generate({
          prompt: fix.slice(0, 1000),
          model: entry.model ?? model,
          aspectRatio: entry.aspect ?? aspect,
          sourceImage: entry.url,
          strength: REFINE_STRENGTH,
        });
        // The user's wording stays on the entry, not the reviewer's: the prompt
        // line under the picture should be the request, and `refinePrompt`
        // records what the second render was actually aimed at.
        const [scored] = annotate([entry], review);
        return {
          ...scored,
          ...result,
          at: Date.now(),
          refined: true,
          parent: entry.url,
          refinePrompt: fix,
          base: { url: entry.url, strength: REFINE_STRENGTH },
        };
      } catch (err) {
        setJudgeNote(
          err instanceof Error ? err.message : "Couldn't refine that picture.",
        );
        return null;
      } finally {
        setRefining(false);
      }
    },
    [annotate, aspect, generate, judge, model],
  );

  /**
   * The better of a picture and its refinement, by the reviewer's own score.
   *
   * Both come back: a refinement that lost is still evidence of what could be
   * improved, and it stays beside the original so the choice is the user's a
   * tap away rather than something the studio decided for them.
   */
  const pickBetter = useCallback(
    async (
      original: HistoryEntry,
      refined: HistoryEntry,
      brief: string,
    ): Promise<{ winner: HistoryEntry; other: HistoryEntry; note: string }> => {
      if (!judge) {
        return { winner: refined, other: original, note: "" };
      }
      try {
        const review = await judge({
          prompt: brief.slice(0, JUDGE_IDEA_LIMIT),
          images: [original.url, refined.url],
        });
        const [before, after] = annotate([original, refined], review);
        const was = before.score ?? 0;
        const now = after.score ?? 0;
        if (review.entries.length < 2) {
          return {
            winner: refined,
            other: original,
            note:
              review.reason ??
              "Kept the refined version — the side-by-side review did not come back.",
          };
        }
        const winner = now >= was ? after : before;
        return {
          winner,
          other: winner === after ? before : after,
          note:
            now >= was
              ? `Refined version kept — ${now}/100 against ${was}/100 before.`
              : `The original scored higher (${was}/100 against ${now}/100), so it stays. The refined take is beside it.`,
        };
      } catch (err) {
        console.warn("[studio] refinement comparison failed:", err);
        return {
          winner: refined,
          other: original,
          note: "Kept the refined version — it couldn't be compared with the original.",
        };
      }
    },
    [annotate, judge],
  );

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
      setExportNote(null);
      setJudgeNote(null);

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
          // The web path never produces takes; leaving the last set on screen
          // would suggest the photos below came from the same press.
          setTakeList([]);
          setTakeNote(null);
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
          if (usedSource.url === seededUrlRef.current) setSeededUsed(true);
          onSourceUsedRef.current?.(usedSource.url);
          grounded = `${grounded}\n\nVariation of the reference image: keep its subject, framing and palette; change what the prompt names.`;
        }

        const request = {
          prompt: grounded,
          model: requestModel,
          aspectRatio: requestAspect,
          sourceImage: usedSource?.url,
          strength: usedSource?.strength,
        };
        // Takes run side by side rather than one after another: the same prompt
        // four times in sequence is four waits, and the first picture would be
        // on screen long before the last one arrived.
        const wanted = Math.max(1, takes);
        setTakeNote(null);
        setTakeList([]);
        const settled = await Promise.allSettled(
          Array.from({ length: wanted }, () => generate(request)),
        );
        const results = settled.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value] : [],
        );
        if (results.length === 0) {
          const failure = settled.find((outcome) => outcome.status === "rejected");
          throw failure && failure.status === "rejected"
            ? failure.reason
            : new Error("Image generation failed.");
        }
        // A take that failed must not throw away the ones that worked, so the
        // shortfall is reported beside the pictures instead of as an error.
        if (results.length < wanted) {
          setTakeNote(
            `${wanted - results.length} of ${wanted} takes didn't come back — keeping the ${results.length} that did.`,
          );
        }
        const shared = {
          kind: "ai" as const,
          prompt: basePrompt,
          model: requestModel,
          aspect: requestAspect,
          instructions: note(instructions) || undefined,
          avoid: note(avoid) || undefined,
          reference: usedReference,
          page: usedPage ?? undefined,
          base: usedSource ?? undefined,
        };
        const entries: HistoryEntry[] = results.map((result) => ({
          ...shared,
          ...result,
          at: Date.now(),
        }));

        // Reviewing the set is what turns several pictures into a best
        // picture. A single take has nothing to be picked against, so it is
        // only reviewed when a refinement is about to be planned from it.
        let ordered = entries;
        let reviewNote: string | null = null;
        if (judge && autoJudge && ordered.length > 1) {
          setJudging(true);
          setJudgeNote("Reviewing the takes…");
          try {
            const review = await judge({
              prompt: grounded.slice(0, JUDGE_IDEA_LIMIT),
              images: ordered.map((item) => item.url),
            });
            if (review.entries.length > 0) {
              ordered = annotate(ordered, review).sort(
                (a, b) => (b.score ?? 0) - (a.score ?? 0),
              );
              reviewNote = `Best of ${ordered.length} picked${
                review.model ? ` by ${review.model}` : ""
              } — ${ordered[0].score ?? 0}/100. Tap a take to keep another.`;
            } else if (review.reason) {
              reviewNote = review.reason;
            }
          } catch (err) {
            console.warn("[studio] take review failed:", err);
          } finally {
            setJudging(false);
          }
        }

        // One refinement pass, then whichever of the two the reviewer prefers.
        // Skipped when the best render already scored high enough that there
        // is nothing to aim a second render at.
        let keep = ordered[0];
        let shown = ordered;
        const bestScore = ordered[0].score ?? 0;
        if (judge && autoRefine && bestScore < GOOD_ENOUGH) {
          const refined = await refineOnce(keep, grounded);
          if (refined) {
            setJudgeNote("Comparing the original and the refined version…");
            const picked = await pickBetter(keep, refined, grounded);
            keep = picked.winner;
            shown = [picked.winner, picked.other];
            reviewNote = picked.note || reviewNote;
          }
        }

        setTakeList(shown);
        setCurrent(keep);
        setPreview(null);
        setJudgeNote(reviewNote);
        // Only the pick enters history: four takes per press would push the
        // rest of the recent list out of its twelve slots in three presses.
        persist([keep, ...history.filter((h) => h.url !== keep.url)]);
      } catch (err) {
        // The chain throws every stage's reason joined by newlines; keeping
        // the text verbatim is what makes the failure diagnosable.
        setError(err instanceof Error ? err.message : "Image generation failed.");
      } finally {
        setBusy(false);
      }
    },      [
      aiPrompt,
      annotate,
      aspect,
      autoJudge,
      autoRefine,
      avoid,
      busy,
      current,
      generate,
      history,
      instructions,
      judge,
      lookup,
      lookups,
      mode,
      model,
      page,
      persist,
      pickBetter,
      prompt,
      refineOnce,
      search,
      source,
      style.id,
      takes,
      webQuery,
    ],
  );

  /**
   * The Refine button: review the picture on screen, draw one improved version
   * from it, and keep whichever the reviewer scores higher.
   */
  const refineNow = useCallback(async () => {
    if (!current || current.kind !== "ai" || !judge || busy || refining || judging) {
      return;
    }
    setBusy(true);
    setError(null);
    setExportNote(null);
    setJudgeNote(null);
    try {
      const brief =
        aiPrompt || current.prompt || "A new take on the reference image";
      const refined = await refineOnce(current, brief);
      if (!refined) return;
      setJudgeNote("Comparing the original and the refined version…");
      const picked = await pickBetter(current, refined, brief);
      setTakeList([picked.winner, picked.other]);
      setTakeNote(null);
      setCurrent(picked.winner);
      setJudgeNote(picked.note);
      persist([
        picked.winner,
        ...history.filter((h) => h.url !== picked.winner.url),
      ]);
    } finally {
      setBusy(false);
    }
  }, [
    aiPrompt,
    busy,
    current,
    history,
    judge,
    judging,
    persist,
    pickBetter,
    refineOnce,
    refining,
  ]);

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
   * Write the 500-word brief with the keyless text model.
   *
   * The brief is for reading. A 500-word description is several times what a
   * diffusion model reads, so the action also returns a compact prompt and
   * that replaces the textarea; Undo brings the user's wording back.
   */
  const writeBrief = useCallback(async () => {
    if (!promptBrief || briefing || busy) return;
    const base = prompt.trim();
    if (!base) return;
    setBriefing(true);
    setBriefResult(null);
    setBriefFor(null);
    setBriefApplied(null);
    setBriefCopied(false);
    setSharpenNote(null);
    try {
      const result = await promptBrief({
        prompt: base,
        style: style.suffix || undefined,
        instructions: note(instructions) || undefined,
        avoid: note(avoid) || undefined,
      });
      const applied =
        result.prompt && result.prompt !== base ? result.prompt : base;
      setBriefResult(result);
      setBriefFor(base);
      setBriefApplied(applied);
      if (applied !== base) {
        setSharpenedFrom(prompt);
        setPrompt(applied);
      }
    } catch (err) {
      setBriefResult({
        brief: "",
        prompt: base,
        words: 0,
        model: null,
        reason:
          err instanceof Error ? err.message : "Couldn't write that brief.",
      });
      setBriefFor(base);
      setBriefApplied(base);
    } finally {
      setBriefing(false);
    }
  }, [
    avoid,
    briefing,
    busy,
    instructions,
    prompt,
    promptBrief,
    style.suffix,
  ]);

  const copyBrief = useCallback(async () => {
    if (!briefResult?.brief) return;
    try {
      await navigator.clipboard.writeText(briefResult.brief);
      setBriefCopied(true);
    } catch {
      setSharpenNote(
        "Clipboard access was blocked; select the brief to copy it.",
      );
    }
  }, [briefResult]);

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

  /** Promote one take from the last press into the result and history. */
  const chooseTake = useCallback(
    (entry: HistoryEntry) => {
      setCurrent(entry);
      persist([entry, ...history.filter((h) => h.url !== entry.url)]);
    },
    [history, persist],
  );

  /**
   * Crop the current picture to one export size.
   *
   * Local work on bytes the studio already has: no provider call, no credit,
   * and the result is the same picture rather than a new take at a new shape.
   */
  const exportOne = useCallback(
    async (preset: ExportPreset) => {
      if (!current || exporting) return;
      setExporting(preset.id);
      setExportNote(null);
      setError(null);
      try {
        const bytes = await renderPreset(current.url, preset);
        saveBlob(toBlob(bytes), exportFileName(current.prompt, preset));
        setExportNote(`${preset.label} saved — ${preset.width}×${preset.height}.`);
      } catch (err) {
        setExportNote(err instanceof Error ? err.message : "Couldn't crop that image.");
      } finally {
        setExporting(null);
      }
    },
    [current, exporting],
  );

  /** All four sizes in one zip, skipping any the browser refuses to encode. */
  const exportAll = useCallback(async () => {
    if (!current || exporting) return;
    setExporting("all");
    setExportNote(null);
    setError(null);
    const entries: { path: string; data: Uint8Array }[] = [];
    const skipped: string[] = [];
    try {
      for (const preset of EXPORT_PRESETS) {
        try {
          entries.push({
            path: exportFileName(current.prompt, preset),
            data: await renderPreset(current.url, preset),
          });
        } catch (err) {
          skipped.push(preset.label);
          console.warn("[studio] export size failed:", preset.id, err);
        }
      }
      if (entries.length === 0) {
        setExportNote(
          "None of the sizes could be cropped — that host doesn't allow canvas reads. The download buttons on the picture still work.",
        );
        return;
      }
      const zip = await zipFiles(entries);
      const name = imageFileName(current.url, current.prompt).replace(/\.[^.]+$/, "");
      saveBlob(toBlob(zip, "application/zip"), `${name}-sizes.zip`);
      setExportNote(
        skipped.length > 0
          ? `Saved ${entries.length} sizes in a zip; skipped ${skipped.join(", ")}.`
          : `Saved all ${entries.length} sizes in one zip.`,
      );
    } catch (err) {
      setExportNote(err instanceof Error ? err.message : "Couldn't build the zip.");
    } finally {
      setExporting(null);
    }
  }, [current, exporting]);

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

  /** One look for the on/off chips above the prompt. */
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
      on
        ? "border-foreground/40 bg-accent text-foreground"
        : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
    );

  /** The public address of the picture on screen, when it has one. */
  const currentShareUrl = current?.shareSlug
    ? shareUrlFor(current.shareSlug)
    : null;
  // A note about one picture must not follow the next one around.
  useEffect(() => {
    setShareNote(null);
  }, [current?.url]);

  /**
   * What Bing is handed. Exactly what a render here would send — the style, the
   * user's instructions and exclusions, and any reference the studio resolved,
   * because a character description left behind is the one thing the other side
   * cannot reconstruct from a name.
   */
  const bingPrompt = [
    aiPrompt || prompt.trim(),
    reference?.brief ?? "",
    page
      ? `Page reference (${page.title}), keep this design recognisable: ${page.brief}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  /** Open Bing Image Creator with this prompt already in its box. */
  const openBing = useCallback(() => {
    const url = bingCreatorUrl(bingPrompt);
    if (!url) {
      setBingError("Write a prompt first — otherwise the tab opens empty.");
      return;
    }
    setBingError(null);
    // The paste box appears in the same press: the next thing the user has is
    // a picture on another tab, and the way back should not be hidden.
    setBingOpen(true);
    // `noopener` because the tab is another site — it must not get a handle on
    // this window through `window.opener`.
    window.open(url, "_blank", "noopener,noreferrer");
  }, [bingPrompt]);

  /**
   * Copy the pre-filled Bing address, so the prompt can be sent to another
   * device — the tab that opens here is not the only place it can be drawn.
   *
   * The link is what gets pasted; the whole prompt follows it only when the
   * address had to clip the ending, which keeps a long brief from arriving
   * truncated on the other side.
   */
  const copyBingLink = useCallback(async () => {
    const url = bingCreatorUrl(bingPrompt);
    if (!url) {
      setBingError("Write a prompt first — there's nothing to send.");
      return;
    }
    const clipped = bingPrompt.replace(/\s+/g, " ").trim().length > BING_PROMPT_LIMIT;
    try {
      await navigator.clipboard.writeText(clipped ? `${url}\n\n${bingPrompt}` : url);
      setBingError(null);
      setBingCopied(true);
      // The copied link is opened elsewhere, but the picture comes back here —
      // so the paste row is revealed now rather than on a button press that
      // will not happen on this device.
      setBingOpen(true);
      window.setTimeout(() => setBingCopied(false), 1600);
    } catch {
      // Same as the viewer's Copy link: a denied clipboard has no fallback
      // worth substituting, so the failure is stated and left there.
      setBingError("Couldn't copy the link — this browser blocked the clipboard.");
    }
  }, [bingPrompt]);

  /**
   * The cloud copy, read through a ref on open.
   *
   * The dashboard builds `cloud` inline, so it is a new object every render;
   * keying this effect on it would re-check Supabase in a loop. The effect reads
   * the newest props instead, and only runs when the dialog opens.
   */
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;
  useEffect(() => {
    if (!open) return;
    const api = cloudRef.current;
    if (!api) return;
    let live = true;
    setCloudNote(null);
    setCloudBusy(null);
    void (async () => {
      try {
        const status = await api.status();
        if (!live) return;
        setCloudStatus(status);
        if (!status.configured) return;
        const checked = await api.check();
        if (!live) return;
        setCloudReady(checked.ok);
        if (!checked.ok) {
          setCloudNote(checked.message);
          return;
        }
        const pulled = await api.pull();
        if (!live) return;
        setCloudRows(pulled.entries);
        if (pulled.message) setCloudNote(pulled.message);
      } catch (err) {
        if (live) {
          setCloudNote(
            err instanceof Error ? err.message : "Couldn't reach Supabase.",
          );
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  /**
   * Copy every picture this browser remembers into Postgres.
   *
   * The last press's takes come first: those are the pictures most likely to be
   * gone by tomorrow, because only the pick was ever written to history.
   */
  const backUpToCloud = useCallback(
    async (onlyPinned = false) => {
      const api = cloudRef.current;
      if (!api) return;
      const seen = new Set<string>();
      const entries = [...takeList, ...history]
        .map(cloudEntryOf)
        .filter((entry): entry is StudioCloudEntry => {
          if (!entry || seen.has(entry.url)) return false;
          seen.add(entry.url);
          return true;
        })
        // Pinned-only is the cheap, deliberate copy: the twelve unpinned
        // pictures rotate away on their own, so they are not what a user is
        // protecting when they press this.
        .filter((entry) => !onlyPinned || entry.pinned);
      if (entries.length === 0) {
        setCloudNote(
          onlyPinned
            ? "Nothing pinned to back up — pin a picture in Recent first."
            : "Nothing to back up yet.",
        );
        return;
      }
      setCloudBusy("backup");
      setCloudNote(null);
      try {
        const result = await api.backup(entries);
        setCloudNote(
          result.message ??
            `Saved ${result.saved} picture${result.saved === 1 ? "" : "s"} to Supabase.`,
        );
        if (result.saved > 0) {
          // The count in the panel is the database's, not this press's.
          const pulled = await api.pull();
          setCloudRows(pulled.entries);
        }
      } catch (err) {
        setCloudNote(
          err instanceof Error ? err.message : "Couldn't reach Supabase.",
        );
      } finally {
        setCloudBusy(null);
      }
    },
    [history, takeList],
  );

  /** Bring the cloud copy into this browser's Recent list. */
  const pullFromCloud = useCallback(async () => {
    const api = cloudRef.current;
    if (!api) return;
    setCloudBusy("pull");
    setCloudNote(null);
    try {
      const result = await api.pull();
      setCloudRows(result.entries);
      if (result.entries.length === 0) {
        setCloudNote(
          result.message ??
            "Nothing saved for this account yet — back something up first.",
        );
        return;
      }
      // Merge by URL. A picture already here keeps this browser's copy, which
      // is the one carrying the score, the refinement and the page reference.
      const byUrl = new Map<string, HistoryEntry>();
      for (const local of history) byUrl.set(local.url, local);
      let added = 0;
      for (const row of result.entries) {
        if (byUrl.has(row.url)) continue;
        byUrl.set(row.url, historyFromCloud(row));
        added += 1;
      }
      persist([...byUrl.values()].sort((a, b) => b.at - a.at));
      setCloudNote(
        added === 0
          ? "Everything saved in Supabase is already in Recent."
          : `Pulled ${added} picture${added === 1 ? "" : "s"} into Recent — the newest ${HISTORY_LIMIT} stay unless pinned.`,
      );
    } catch (err) {
      setCloudNote(
        err instanceof Error ? err.message : "Couldn't reach Supabase.",
      );
    } finally {
      setCloudBusy(null);
    }
  }, [history, persist]);

  /**
   * Publish the picture on screen behind a link.
   *
   * The link is copied straight away because that is what it is for — a share
   * action whose result has to be selected and copied by hand is one press away
   * from not being used.
   */
  const shareCurrent = useCallback(async () => {
    const api = cloudRef.current;
    if (!api || !current) return;
    const entry = cloudEntryOf(current);
    if (!entry) {
      setShareNote(
        "This picture is inline data, so it has no address a link could open.",
      );
      return;
    }
    setShareBusy(true);
    setShareNote(null);
    try {
      const result = await api.share(entry);
      if (!result.slug) {
        setShareNote(result.message ?? "Couldn't create the link.");
        return;
      }
      const shared: HistoryEntry = { ...current, shareSlug: result.slug };
      setCurrent(shared);
      persist(history.map((h) => (h.url === shared.url ? shared : h)));
      try {
        await navigator.clipboard.writeText(shareUrlFor(result.slug));
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1600);
      } catch {
        // A denied clipboard is not a failed share: the link is on screen.
      }
      setShareNote("Anyone with the link can open this picture.");
    } catch (err) {
      setShareNote(
        err instanceof Error ? err.message : "Couldn't reach Supabase.",
      );
    } finally {
      setShareBusy(false);
    }
  }, [current, history, persist]);

  /** Retire the link, which is the only way back from "public". */
  const stopSharing = useCallback(async () => {
    const api = cloudRef.current;
    const slug = current?.shareSlug;
    if (!api || !current || !slug) return;
    setShareBusy(true);
    setShareNote(null);
    try {
      const result = await api.unshare(slug);
      if (!result.ok) {
        setShareNote(result.message ?? "Couldn't revoke the link.");
        return;
      }
      const revoked: HistoryEntry = { ...current, shareSlug: undefined };
      setCurrent(revoked);
      persist(history.map((h) => (h.url === revoked.url ? revoked : h)));
      setShareNote("Link revoked — it no longer opens anything.");
    } catch (err) {
      setShareNote(
        err instanceof Error ? err.message : "Couldn't reach Supabase.",
      );
    } finally {
      setShareBusy(false);
    }
  }, [current, history, persist]);

  /**
   * Adopt a picture Bing drew as a take in this studio.
   *
   * Nothing is re-uploaded: the address Bing serves is public, so the entry is
   * the URL — which keeps Download, Compare and Refine working on it exactly as
   * they do on a render from the chain.
   */
  const useBingImage = useCallback(() => {
    const value = bingLink.trim();
    // A copied address often arrives as markdown (`![alt](url)`) or wrapped in
    // angle brackets; unwrapping it is kinder than rejecting it.
    const unwrapped = value
      .replace(/^!?\[[^\]]*\]\(([^)]+)\)$/, "$1")
      .replace(/^<|>$/g, "")
      .trim();
    let parsed: URL;
    try {
      parsed = new URL(unwrapped);
    } catch {
      setBingError("That isn't a link — right-click the picture and copy its address.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      setBingError("Only http(s) image links can be used here.");
      return;
    }

    const entry: HistoryEntry = {
      kind: "ai",
      url: parsed.toString(),
      prompt: prompt.trim(),
      at: Date.now(),
      provider: "bing",
      aspect,
      instructions: note(instructions) || undefined,
      avoid: note(avoid) || undefined,
      reference: reference?.brief,
      page: page ?? undefined,
    };
    setCurrent(entry);
    setPreview(null);
    setTakeList([entry]);
    setTakeNote(null);
    setBingLink("");
    setBingError(null);
    persist([entry, ...history.filter((h) => h.url !== entry.url)]);
  }, [aspect, avoid, history, instructions, page, persist, prompt, reference]);

  return (
    <>
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
            take on one you already have. Renders are reviewed against your
            prompt, the best take is kept, and it can be refined once more —
            results open in the viewer here, and the download button saves the
            file itself.
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
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLibraryOpen(true)}
                title="Pictures already stored in your Cloudinary account — pick one to vary"
                className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
              >
                <FolderOpen className="size-3" />
                My Cloudinary library
              </button>
            </div>
          </div>

          {/* ---- Prompt ---- */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Prompt
              </span>
              {resolved === "ai" && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                  {promptBrief && (
                    <button
                      type="button"
                      onClick={() => void writeBrief()}
                      disabled={briefing || polishing || busy || !prompt.trim()}
                      title="Write a ~500-word brief for this image type with the free text model — no API key. The compact prompt it returns is what the generator uses."
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {briefing ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <FileText className="size-3" />
                      )}
                      {briefing ? "Writing brief…" : "500-word brief"}
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
            {resolved === "ai" && briefResult ? (
              <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Prompt brief
                    {briefResult.words > 0
                      ? ` · ${briefResult.words} words`
                      : ""}
                  </p>
                  {briefResult.brief ? (
                    <button
                      type="button"
                      onClick={() => void copyBrief()}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      {briefCopied ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {briefCopied ? "Copied" : "Copy brief"}
                    </button>
                  ) : null}
                </div>
                {briefResult.brief ? (
                  <div className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap pr-1 text-[11px] leading-4 text-muted-foreground">
                    {briefResult.brief}
                  </div>
                ) : (
                  <p className="mt-1 text-[11px] leading-4 text-amber-700 dark:text-amber-400">
                    {briefResult.reason ?? "The brief came back empty."}
                  </p>
                )}
                {briefResult.brief && briefResult.reason ? (
                  <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
                    {briefResult.reason}
                  </p>
                ) : null}
                {briefResult.brief &&
                briefFor !== null &&
                briefApplied !== null &&
                prompt.trim() !== briefFor &&
                prompt.trim() !== briefApplied ? (
                  <p className="mt-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-400">
                    This brief describes the earlier wording. Press 500-word
                    brief again to refresh it.
                  </p>
                ) : null}
                {briefResult.model ? (
                  <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground/80">
                    Written by {briefResult.model} · no API key used. Free
                    tier: one brief every 45 seconds. The compact prompt is in
                    the box above; the full brief is for reference.
                  </p>
                ) : null}
              </div>
            ) : null}
            {describing ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Reading the image for a starting prompt…
              </p>
            ) : describeNote ? (
              <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{describeNote}</p>
            ) : null}

            {/* ---- Style presets (AI only: a style suffix means nothing to a
                web search, which returns what already exists) ---- */}
            {resolved === "ai" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStyleId(s.id);
                      // A brief is written for one image type; keeping it
                      // beside a new type would describe the wrong picture.
                      setBriefResult(null);
                      setBriefFor(null);
                      setBriefApplied(null);
                      setBriefCopied(false);
                    }}
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

            {resolved === "ai" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Takes
                </span>
                <div className="flex gap-1">
                  {TAKE_COUNTS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setTakes(count)}
                      aria-pressed={takes === count}
                      title={
                        count === 1
                          ? "One picture per press"
                          : `Draw ${count} takes at once and keep the best`
                      }
                      className={cn(
                        "h-8 flex-1 rounded-md border px-3 text-xs transition-colors sm:flex-none",
                        takes === count
                          ? "border-foreground/40 bg-accent text-foreground"
                          : "border-border/70 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                      )}
                    >
                      {count}
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

          {/* ---- Bing Image Creator: a hand-off, because there is no API to
              call. The prompt travels in the link; the picture comes back as
              an address, and is then a take like any other. ---- */}
          {resolved === "ai" && (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">
                  Bing Image Creator takes a better shot at long prompts, but it
                  has no API — so this opens it on a new tab with your prompt
                  already filled in, then paste the picture's link back here to
                  review, refine or keep it.
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyBingLink}
                    disabled={!bingPrompt}
                    title={
                      bingPrompt
                        ? "Copy the link with your prompt already in it — open it on any device"
                        : "Write a prompt first"
                    }
                  >
                    {bingCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {bingCopied ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openBing}
                    disabled={busy || !bingPrompt}
                    title={
                      bingPrompt
                        ? "Open Bing Image Creator with this prompt in its box"
                        : "Write a prompt first"
                    }
                  >
                    <ExternalLink className="size-3.5" />
                    Open in Bing
                  </Button>
                </div>
              </div>

              {bingOpen && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={bingLink}
                    onChange={(e) => {
                      setBingLink(e.target.value);
                      setBingError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        useBingImage();
                      }
                    }}
                    placeholder="Paste the image link Bing gave you"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    // 16px on phones for the same reason as the prompt box.
                    className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70 sm:text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={useBingImage}
                    disabled={!bingLink.trim()}
                  >
                    Use it
                  </Button>
                </div>
              )}

              {bingError && (
                <p className="mt-1.5 text-[11px] leading-4 text-destructive">
                  {bingError}
                </p>
              )}
            </div>
          )}

          {resolved === "ai" && judge && (judging || refining || judgeNote) && (
            <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
              {(judging || refining) && (
                <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />
              )}
              {judging
                ? "Reviewing the takes — scoring each one against your prompt…"
                : refining
                  ? "Refining — drawing one improved version from this picture…"
                  : judgeNote}
            </p>
          )}

          {/* ---- Self-hosted endpoint (optional, collapsed) ---- */}
          <OwnImageServer />

          {resolved === "ai" && (
            <div className="flex flex-wrap items-center gap-1.5">
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
                className={chipClass(lookups)}
                title="Looks up each named character's design and newest form before drawing"
              >
                <UserRound className="size-3" />
                Character looks {lookups ? "on" : "off"}
              </button>

              {judge && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoJudge}
                  onClick={() => {
                    const next = !autoJudge;
                    setAutoJudge(next);
                    try {
                      localStorage.setItem(JUDGE_KEY, String(next));
                    } catch {
                      // Private mode: the setting just lasts this visit.
                    }
                  }}
                  className={chipClass(autoJudge)}
                  title="After several takes, review them against the prompt and keep the best one"
                >
                  <ScanEye className="size-3" />
                  Pick best {autoJudge ? "on" : "off"}
                </button>
              )}

              {judge && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoRefine}
                  onClick={() => {
                    const next = !autoRefine;
                    setAutoRefine(next);
                    try {
                      localStorage.setItem(REFINE_KEY, String(next));
                    } catch {
                      // Private mode: the setting just lasts this visit.
                    }
                  }}
                  className={chipClass(autoRefine)}
                  title="After the render, review it, draw one improved version and keep whichever scored higher"
                >
                  <Wand2 className="size-3" />
                  Auto-refine {autoRefine ? "on" : "off"}
                  <span className="opacity-60">+1 render</span>
                </button>
              )}
            </div>
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
              {takeList.length > 1 && (
                <div className="border-b border-border/70 bg-muted/25 p-1.5">
                  <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {takeList.some((take) => take.refined || take.parent)
                        ? "Original & refined"
                        : `Takes — ${takeList.length}`}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground/80">
                      {takeNote ?? "tap one to keep it"}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {takeList.map((take, index) => {
                      const picked = take.url === current.url;
                      return (
                        <div
                          key={take.url + index}
                          className={cn(
                            "relative flex-1 overflow-hidden rounded-md border",
                            picked ? "border-primary/70" : "border-border/70",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => chooseTake(take)}
                            className="block w-full"
                            aria-pressed={picked}
                            title={picked ? "This is the one being shown" : "Keep this take"}
                          >
                            <img
                              src={take.url}
                              alt={`Take ${index + 1}`}
                              loading="lazy"
                              className="aspect-square w-full object-cover"
                            />
                          </button>
                          <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/65 px-1 py-0.5 text-[9px] font-medium text-white">
                            {index + 1}
                          </span>
                          {take.score ? (
                            <span
                              className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/65 px-1 py-0.5 text-[9px] font-medium tabular-nums text-white"
                              title={take.verdict ?? `Scored ${take.score}/100`}
                            >
                              {take.score}
                            </span>
                          ) : null}
                          {picked ? (
                            <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-primary px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                              <Check className="size-2.5" />
                              kept
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => save(take.url)}
                            title="Download this take"
                            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded bg-black/65 text-white transition-colors hover:bg-black/85"
                          >
                            <Download className="size-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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
                <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                  {current.refined ? (
                    <>
                      <Wand2 className="size-2.5" />
                      refined · {current.provider ?? "image"}
                    </>
                  ) : (
                    (current.provider ?? "image")
                  )}
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
              {(current.score || (current.refined && current.parent)) && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                  {current.score ? (
                    <span className="flex min-w-0 items-start gap-1.5">
                      <Award className="mt-0.5 size-3 shrink-0" />
                      <span className="min-w-0">
                        <span className="font-medium tabular-nums text-foreground">
                          {current.score}/100
                        </span>{" "}
                        {current.verdict ?? "reviewed against the prompt"}
                      </span>
                    </span>
                  ) : null}
                  {current.refined && current.parent ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({
                          urls: [current.parent as string, current.url],
                          index: 1,
                        })
                      }
                      title="See the picture this one refined"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      <GitCompare className="size-3" />
                      Compare
                    </button>
                  ) : null}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-background px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {current.prompt}
                </span>
                {judge ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refineNow()}
                    disabled={busy || refining || judging}
                    title="Review this picture, draw one improved version from it, and keep whichever scored higher"
                  >
                    {refining || judging ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="size-3.5" />
                    )}
                    {refining || judging ? "Refining…" : "Refine"}
                  </Button>
                ) : null}
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

              {/* ---- Export sizes: the same picture, cut to the shapes it is
                  actually posted in. Local canvas work, no new render. ---- */}
              <div className="border-t border-border/70 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Export sizes
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    cropped in this tab — no new render
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {EXPORT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void exportOne(preset)}
                      disabled={exporting !== null}
                      title={`${preset.hint} — grows or trims the picture to ${preset.width}×${preset.height}`}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {exporting === preset.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Download className="size-3" />
                      )}
                      {preset.label}
                      <span className="opacity-60">
                        {preset.width}×{preset.height}
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void exportAll()}
                    disabled={exporting !== null}
                    className="inline-flex items-center gap-1 rounded-full border border-foreground/30 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                    title="Crop every size and download them as one zip"
                  >
                    {exporting === "all" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    All as zip
                  </button>
                </div>
                {exportNote && (
                  <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                    {exportNote}
                  </p>
                )}
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
                {cloud?.share && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void shareCurrent()}
                    disabled={busy || shareBusy || !cloudReady}
                    title={
                      current.shareSlug
                        ? "Share again — this replaces the current link"
                        : "Create a public link anyone can open"
                    }
                  >
                    {shareBusy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Share2 className="size-3.5" />
                    )}
                    Share
                  </Button>
                )}
                <Button size="sm" onClick={() => save(current.url)}>
                  <Download className="size-3.5" />
                  Download
                </Button>
              </div>

              {currentShareUrl && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/20 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                    {currentShareUrl}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(currentShareUrl)
                        .then(() => {
                          setShareCopied(true);
                          window.setTimeout(() => setShareCopied(false), 1600);
                        })
                        .catch(() =>
                          setShareNote(
                            "Couldn't copy — select the address above instead.",
                          ),
                        );
                    }}
                  >
                    {shareCopied ? (
                      <Check className="size-3.5" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                    {shareCopied ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void stopSharing()}
                    disabled={shareBusy}
                  >
                    Stop sharing
                  </Button>
                </div>
              )}

              {shareNote && (
                <p className="border-t border-border/70 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                  {shareNote}
                </p>
              )}
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
                        setTakeList([]);
                        setTakeNote(null);
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
                        setJudgeNote(null);
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
                      {h.kind === "web" ? "web" : h.refined ? "refined" : "ai"}
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

          {/* ---- The SQL copy, when the deployment has Supabase ---- */}
          {cloud && (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Cloud copy — Supabase
                  </span>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {cloudStatus === null
                      ? "Checking the Supabase copy…"
                      : !cloudStatus.configured
                        ? "Not configured — add SUPABASE_URL and SUPABASE_SECRET_KEY in the Keys tab."
                        : !cloudReady
                          ? "Key found, but the table isn't ready yet — see below."
                          : `${cloudRows.length} picture${
                              cloudRows.length === 1 ? "" : "s"
                            } saved in Postgres${
                              cloudStatus.urlHost
                                ? ` · ${cloudStatus.urlHost}`
                                : ""
                            } — readable on another device.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void backUpToCloud()}
                    disabled={
                      !cloudReady || cloudBusy !== null || history.length === 0
                    }
                    title="Copy this browser's pictures to Supabase — pressing twice updates, it does not duplicate"
                  >
                    {cloudBusy === "backup" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CloudUpload className="size-3.5" />
                    )}
                    Back up
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void backUpToCloud(true)}
                    disabled={
                      !cloudReady ||
                      cloudBusy !== null ||
                      !history.some((entry) => entry.pinned)
                    }
                    title="Copy only the pinned pictures — the ones that would otherwise rotate out of Recent"
                  >
                    <Star className="size-3.5" />
                    Pinned
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void pullFromCloud()}
                    disabled={!cloudReady || cloudBusy !== null}
                    title="Bring pictures saved on other devices into Recent"
                  >
                    {cloudBusy === "pull" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CloudDownload className="size-3.5" />
                    )}
                    Pull
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      navigate("/gallery");
                    }}
                    title="Every picture backed up to Supabase, searchable"
                  >
                    <Images className="size-3.5" />
                    Gallery
                  </Button>
                </div>
              </div>

              {cloudNote && (
                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
                  {cloudNote}
                </p>
              )}

              {cloudStatus?.warnings.map((warning) => (
                <p
                  key={warning}
                  className="mt-1.5 text-[11px] leading-4 text-destructive"
                >
                  {warning}
                </p>
              ))}
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

      {/* Sibling of the studio's own dialog: a library picture becomes the
          variation source with the strength the author already chose. */}
      <CloudinaryLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onUse={(asset: CloudinaryAsset) => {
          setLibraryOpen(false);
          setSource({
            url: asset.url,
            strength: source?.strength ?? STRENGTHS[1].id,
          });
        }}
      />
    </>
  );
}
