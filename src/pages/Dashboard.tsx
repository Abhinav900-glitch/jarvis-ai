import { useConvex, useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Box,
  Brain,
  Calculator,
  Camera,
  CameraOff,
  Check,
  Code2,
  Download,
  FileSearch,
  FileText,
  Equal,
  Copy,
  FunctionSquare,
  Globe,
  ImagePlus,
  Languages,
  Loader2,
  Link2,
  Mic,
  Menu,
  Moon,
  Newspaper,
  Pencil,
  Paperclip,
  Plus,
  RotateCcw,
  CornerDownRight,
  Keyboard,
  Search,
  Puzzle,
  Settings,
  Shapes,
  Square,
  Sun,
  Trash2,
  User,
  Volume2,
  AudioLines,
  VolumeX,
  Wand2,
  Waves,
  X,
  Zap,
  Home,
  Lightbulb,
  Bookmark,
  AlarmClock,
  GitBranch,
  GitCompare,
  Headphones,
  Pin,
  Sparkles,
  Bot,
  Gauge,
  BookOpen,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { JarvisIcon } from "@/components/jarvis-icon";
import { JarvisHud, type HudPhase, type LiveTurn } from "@/components/jarvis-hud";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ImageStudio } from "@/components/image-studio";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { GestureAction } from "@/lib/gesture-actions";
import { JarvisOrb } from "@/components/jarvis-orb";
import { Lightbox } from "@/components/lightbox";
import { MarkdownMessage } from "@/components/markdown-message";
import { looksLikeMathOrMarkdown } from "@/lib/markdown-normalize";
import { CodePanel } from "@/components/code-panel";
import { AeroTransformGenPanel } from "@/components/aerotransformgen-panel";
import { AeroTransformGenDashboard } from "@/components/aerotransformgen-dashboard";
import { sanitizeForSpeech } from "@/lib/speech";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { PALETTES, usePalette } from "@/hooks/use-palette";
import { useVoicePlayer, useVoiceRecorder } from "@/hooks/use-voice";
import { useLiveMode } from "@/hooks/use-live";
import { useSoundEffects } from "@/hooks/use-sound-effects";
import { findSoundCues, isSoundOnlyRequest, cueLine, SOUND_CUES, type SoundCue } from "@/lib/sound-effects";
import { findYouTubeLinks, MAX_VIDEOS_PER_TURN } from "@/lib/youtube";
import { findWebImageQuery } from "@/lib/web-images";
import { stripWakeWord } from "@/lib/wake-word";
import { playAckChime, stopThinkingHum } from "@/lib/audio";
import { getTranslateLanguage, TRANSLATE_LANGUAGES } from "@/lib/languages";
import {
  ELEVENLABS_VOICES,
  SARVAM_SPEAKERS,
  VOICE_PREVIEW_TEXT,
  describeVoice,
  loadVoicePreference,
  saveVoicePreference,
  type VoicePreference,
} from "@/lib/voices";
import { COUNTRIES, getCountry } from "@/lib/languages";
import {
  describePuterEnvironment,
  generateImageWithPuter,
  getPuterSignInStatus,
  signInToPuter,
  signOutOfPuter,
  type PuterSignInStatus,
} from "@/lib/puter";
import {
  decryptMaybe,
  isCiphertext,
  lockEverything,
  peekPlaintext,
  rememberPlaintext,
} from "@/lib/e2e";
import { useDecryptedTitles, useE2EKey } from "@/lib/use-e2e";
import {
  PASSPHRASE_REQUIRED,
  useAppendMessage,
  useRenameSession,
  useStartWithMessage,
} from "@/lib/messages";
import { PassphraseGate } from "@/components/passphrase-gate";
import { SessionStatsDialog } from "@/components/session-stats-dialog";
import { Radio, ExternalLink } from "lucide-react";
import { CalculatorPanel } from "@/components/calculator-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { ExportPanel } from "@/components/export-panel";
import { useCamera } from "@/hooks/use-camera";
import { useLiveTranslation } from "@/hooks/use-live-translation";
import { toast } from "sonner";
import {
  CommandPalette,
  type PaletteCommand,
} from "@/components/command-palette";
import { PersonaPanel } from "@/components/persona-panel";
import { PersonaPicker } from "@/components/persona-picker";
import { TasksPanel } from "@/components/tasks-panel";
import { ProjectSidebar } from "@/components/project-sidebar";
import { BranchBar, BranchMenu } from "@/components/branch-bar";
import { cn } from "@/lib/utils";
import { AnswerInspector } from "@/components/answer-inspector";
import { PinnedPanel } from "@/components/pinned-panel";
import { SlashMenu } from "@/components/slash-menu";
import { BranchCompare, type CompareSide } from "@/components/branch-compare";
import { ProviderHealth } from "@/components/provider-health";
import { LiveTuning } from "@/components/live-tuning";
import { EnginePanel } from "@/components/engine-panel";
import { PluginsDialog } from "@/components/plugins-dialog";
import { McpPanel } from "@/components/mcp-panel";
import { IntegrationsPanel } from "@/components/integrations-panel";
import type { IntegrationPanel } from "@/lib/integrations";
import { LiveSessionPanel } from "@/live/live-session-panel";
import { useListeningQueue } from "@/hooks/use-listening-queue";
import {
  filterSlashCommands,
  matchSlashCommand,
  type SlashCommand,
} from "@/lib/slash-commands";

/** An uploaded document waiting on the composer, not yet sent. */
interface PendingFile {
  url: string;
  name: string;
  type: string;
  size: number;
  /**
   * Extracted text for files the model should *read* rather than merely see
   * (source files, CSV, JSON, plain text). Binary documents keep this unset.
   */
  text?: string;
}

/** How much of each text attachment is worth paying tokens for. */
const MAX_ATTACHMENT_TEXT = 20_000;
const MAX_TOTAL_ATTACHMENT_TEXT = 60_000;

/**
 * Whether a file can be read as text in the browser.
 *
 * Deliberately conservative: an `.md` or `.py` is worth inlining, and a
 * spreadsheet or archive is not — mis-reading one as UTF-8 would put a wall of
 * replacement characters into the prompt.
 */
function isTextLike(file: File): boolean {
  if (/^(text\/|application\/(json|xml|javascript|typescript|x-yaml|yaml|toml))/.test(file.type))
    return true;
  return /\.(txt|md|markdown|csv|tsv|json|ya?ml|toml|log|sql|[a-z]?[jt]sx?|py|java|kt|go|rs|rb|php|c|h|cpp|hpp|cs|swift|sh|bash|zsh|html|css|vue|svelte)$/i.test(
    file.name,
  );
}

/**
 * Inline the readable attachments into the prompt as a fenced block.
 *
 * A bare link is useless to a text model — it cannot open the file. Inlining
 * the text (already budget-capped at upload time) is what actually lets Jarvis
 * read a pasted file, while the transcript keeps the original link.
 */
function attachmentPrompt(files: PendingFile[]): string {
  const readable = files.filter((f) => f.text);
  if (readable.length === 0) return "";
  const body = readable
    .map((f) => `<file name="${f.name}">\n${f.text}\n</file>`)
    .join("\n\n");
  return `The user attached ${readable.length} file${readable.length > 1 ? "s" : ""}. Their contents are below.\n\n${body}`;
}

// ---------------------------------------------------------------------------
// Source types
// ---------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  domain?: string;
}

interface NewsItem {
  title: string;
  url: string;
  source?: string;
  publishedAt?: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** An AI-generated image stored on an assistant message — click to zoom. */
function GeneratedImage({
  url,
  onOpen,
}: {
  url: string;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="mb-3 block max-w-md cursor-zoom-in overflow-hidden rounded-lg border"
      title="View full size"
    >
      <img
        src={url}
        alt="Generated image"
        className="w-full object-cover transition-opacity hover:opacity-90"
      />
    </button>
  );
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Sources
      </p>
      <ul className="mt-2 space-y-1.5">
        {sources.map((s, i) => (
          <li key={i} className="flex items-baseline gap-2 text-xs">
            <span className="shrink-0 text-muted-foreground">[{i + 1}]</span>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {s.title}
              {s.domain ? (
                <span className="ml-1 text-muted-foreground/60">
                  — {s.domain}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NlpResult {
  language?: unknown;
  entities?: unknown;
  similarity?: unknown;
}

function formatNlp(result: NlpResult | null): string {
  if (!result) return "";
  const lines: string[] = [];
  const lang = result.language as
    | { language_name?: string; language_code?: string }
    | null;
  if (lang?.language_name) {
    lines.push(
      `Language: ${lang.language_name}${lang.language_code ? ` (${lang.language_code})` : ""}`,
    );
  }
  const ents = result.entities as Record<string, unknown> | null;
  const list = (ents?.entities ?? ents?.results) as
    | { text?: string; label?: string }[]
    | undefined;
  if (Array.isArray(list) && list.length > 0) {
    const uniq = list
      .slice(0, 8)
      .map(
        (e) => `${e.text ?? "?"}${e.label ? ` (${e.label})` : ""}`,
      );
    lines.push(`Entities: ${uniq.join(", ")}`);
  }
  const sim = result.similarity as { similarity?: number } | null;
  if (typeof sim?.similarity === "number") {
    lines.push(`Similarity score: ${(sim.similarity * 100).toFixed(1)}%`);
  }
  return lines.join("\n");
}

function NewsPanel({ items }: { items: NewsItem[] }) {
  return (
    <div className="border-t pt-3">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Latest news — mediastack
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((n, i) => (
          <li key={i} className="text-xs leading-5">
            <a
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-2 hover:underline"
            >
              {n.title}
            </a>
            <span className="ml-1.5 text-muted-foreground">
              {n.source ? `· ${n.source}` : ""}
              {n.publishedAt
                ? ` · ${new Date(n.publishedAt).toLocaleDateString()}`
                : ""}
            </span>
          </li>
        ))}
      </ul>    </div>
  );
}

// Region result card component
function RegionResultCard({ result, onClose }: { result: Record<string, unknown>; onClose: () => void }) {
  // A plain render helper, not a component: declaring it as a component inside
  // the panel body remounted the button on every render.
  const closeButton = (
    <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
  );

  if (result.type === "time") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">World Time</span>
          {closeButton}
        </div>
        <p className="text-2xl font-mono font-semibold tabular-nums">{String(result.time)}</p>
        <p className="text-xs text-muted-foreground">{String(result.dayOfWeek)}, {String(result.date)} · {String(result.timezone)} ({String(result.offset)})</p>
      </div>
    );
  }

  if (result.type === "weather") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Weather</span>
          {closeButton}
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-2xl">{String(result.icon)}</span>
          <span className="text-2xl font-semibold">{String(result.temp)}°C</span>
          <span className="text-xs text-muted-foreground">feels like {String(result.feelsLike)}°C</span>
        </div>
        <p className="text-xs text-muted-foreground">{String(result.description)} · {String(result.city)}, {String(result.country)} · 💧 {String(result.humidity)}% · 💨 {String(result.wind)} km/h</p>
      </div>
    );
  }

  if (result.type === "currency") {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Currency</span>
          {closeButton}
        </div>
        <p className="text-2xl font-semibold tabular-nums">{String(result.amount)} {String(result.from)} = <span className="text-primary">{String(result.result)} {String(result.to)}</span></p>
        <p className="text-xs text-muted-foreground">1 {String(result.from)} = {String(result.rate)} {String(result.to)}</p>
      </div>
    );
  }

  if (result.type === "country") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Country</span>
          {closeButton}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl">{String(result.flag)}</span>
          <span className="text-lg font-semibold">{String(result.name)}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div><span className="text-muted-foreground">Official:</span> {String(result.officialName)}</div>
          <div><span className="text-muted-foreground">Capital:</span> {String(result.capital)}</div>
          <div><span className="text-muted-foreground">Region:</span> {String(result.region)}{result.subregion ? ` / ${String(result.subregion)}` : ""}</div>
          <div><span className="text-muted-foreground">Population:</span> {typeof result.population === "number" ? result.population.toLocaleString() : String(result.population)}</div>
          <div><span className="text-muted-foreground">Area:</span> {typeof result.area === "number" ? result.area.toLocaleString() : String(result.area)} km²</div>
          <div><span className="text-muted-foreground">Languages:</span> {Array.isArray(result.languages) ? (result.languages as string[]).join(", ") : String(result.languages)}</div>
          <div><span className="text-muted-foreground">Currencies:</span> {Array.isArray(result.currencies) ? (result.currencies as string[]).join(", ") : String(result.currencies)}</div>
          <div><span className="text-muted-foreground">Timezones:</span> {Array.isArray(result.timezones) ? (result.timezones as string[]).slice(0, 3).join(", ") : String(result.timezones)}{Array.isArray(result.timezones) && (result.timezones as string[]).length > 3 ? ` +${(result.timezones as string[]).length - 3} more` : ""}</div>
        </div>
        {result.maps ? (
          <a href={String(result.maps)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline">
            Open in Maps
          </a>
        ) : null}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Voice panel
// ---------------------------------------------------------------------------

interface VoiceNoteResult {
  text: string;
  summary?: string;
  sentiment: { positive: number; neutral: number; negative: number };
  chapters?: { headline: string; summary: string }[];
}

function SentimentBar({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] text-muted-foreground">
        {value}%
      </span>
    </div>
  );
}

function VoicePanel({
  note,
  onUse,
}: {
  note: VoiceNoteResult;
  onUse: (text: string) => void;
}) {
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Voice note — AssemblyAI
        </p>
        <button
          onClick={() => onUse(note.text)}
          className="text-[10px] uppercase tracking-widest text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Use text
        </button>
      </div>
      <p className="mt-2 text-sm leading-6">{note.text}</p>
      {note.summary ? (
        <p className="mt-2 border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
          {note.summary}
        </p>
      ) : null}
      <div className="mt-3 space-y-1.5">
        <SentimentBar
          label="Positive"
          value={note.sentiment.positive}
          tone="bg-foreground"
        />
        <SentimentBar
          label="Neutral"
          value={note.sentiment.neutral}
          tone="bg-muted-foreground/50"
        />
        <SentimentBar
          label="Negative"
          value={note.sentiment.negative}
          tone="bg-destructive/60"
        />
      </div>    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const sessionsQuery = useQuery(api.chats.listSessions);
  // A stable empty array, so memoised values that read `sessions` do not
  // rebuild on every render while the query is still loading.
  const sessions = useMemo(() => sessionsQuery ?? [], [sessionsQuery]);
  const [activeId, setActiveId] = useState<Id<"chatSessions"> | null>(null);
  // Which line of the conversation is on screen. Null is the main line, and
  // the only line for every chat that has never been edited or regenerated.
  const [activeBranchId, setActiveBranchId] = useState<Id<"chatBranches"> | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [showPersona, setShowPersona] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  /** `setup` before a passphrase exists, `unlock` once one does, null when closed. */
  const [passphraseOpen, setPassphraseOpen] = useState<
    "setup" | "unlock" | null
  >(null);
  // Which chat we have already prompted about, so opening a locked
  // conversation asks once instead of snapping the dialog shut every time the
  // user dismisses it.
  const promptedUnlockFor = useRef<string | null>(null);
  const rawMessages = useQuery(
    api.chats.listMessages,
    activeId ? { sessionId: activeId, branchId: activeBranchId } : "skip",
  );

  // ---------------------------------------------------------------------------
  // Decryption
  //
  // What you typed is ciphertext in the database and plaintext here, and only
  // while the passphrase is unlocked in this tab. Reads go through a synchronous
  // cache seeded at write time, so your own message renders as typed instead of
  // arriving one async pass later; anything older — a chat reopened after a
  // reload — is filled in by the effect below.
  //
  // A locked tab gets an empty list plus the passphrase prompt, never a
  // screenful of base64.
  // ---------------------------------------------------------------------------
  const keyMaterial = useQuery(api.chats.keyMaterial);
  const e2eKey = useE2EKey(keyMaterial?.salt);
  const [decryptTick, setDecryptTick] = useState(0);

  const encryptedRows = useMemo(
    () =>
      (rawMessages ?? []).some(
        (m) => m.role === "user" && isCiphertext(m.content),
      ),
    [rawMessages],
  );
  const lockedOut = encryptedRows && !e2eKey;

  useEffect(() => {
    if (!e2eKey || !rawMessages) return;
    let cancelled = false;
    void (async () => {
      let filled = false;
      for (const m of rawMessages) {
        if (m.role !== "user" || !isCiphertext(m.content)) continue;
        if (peekPlaintext(m.content) !== undefined) continue;
        const plain = await decryptMaybe(e2eKey, m.content);
        rememberPlaintext(m.content, plain);
        filled = true;
      }
      if (!cancelled && filled) setDecryptTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [rawMessages, e2eKey]);

  const messages = useMemo(() => {
    if (!rawMessages) return undefined;
    if (!encryptedRows) return rawMessages;
    if (!e2eKey) return [];
    return rawMessages.map((m) => {
      if (m.role !== "user" || !isCiphertext(m.content)) return m;
      const plain = peekPlaintext(m.content);
      return plain === undefined ? { ...m, content: "" } : { ...m, content: plain };
    });
    // decryptTick is read on purpose: it is what re-runs this memo when an
    // async decrypt lands after the rows themselves stopped changing.
  }, [rawMessages, e2eKey, encryptedRows, decryptTick]);

  useEffect(() => {
    if (!lockedOut) {
      promptedUnlockFor.current = null;
      return;
    }
    if (promptedUnlockFor.current === activeId) return;
    promptedUnlockFor.current = activeId;
    setPassphraseOpen("unlock");
  }, [lockedOut, activeId]);

  // A chat can pin a persona of its own; it overrides the user's default for
  // every reply in that conversation.
  const activePersonaId = useMemo(
    () => sessions.find((s) => s._id === activeId)?.personaId ?? undefined,
    [sessions, activeId],
  );

  // Encrypting wrappers — every call site below reads exactly as it did
  // before, but the text is sealed before it reaches the network.
  const startWithMessage = useStartWithMessage();
  const appendMessage = useAppendMessage();
  const askAction = useAction(api.ai.ask);
  const askStreamAction = useAction(api.ai.askStream);
  const deepResearchAction = useAction(api.ai.deepResearch);
  const analyzeAction = useAction(api.ai.analyzeText);
  const newsAction = useAction(api.ai.searchNews);
  const transcribeAction = useAction(api.voice.transcribe);
  const transcribeWhisperAction = useAction(api.voice.transcribeWhisper);
  const speakAction = useAction(api.voice.speak);
  const translateAction = useAction(api.translate.translate);
  const getSignedUploadUrl = useAction(api.cloudinary.getSignedUploadUrl);
  const generateImageAction = useAction(api.cloudinary.generateImage);
  const summarizeUrlAction = useAction(api.ai.summarizeUrl);
  const getWorldTimeAction = useAction(api.ai.getWorldTime);
  const getCurrencyRateAction = useAction(api.ai.getCurrencyRate);
  const getWeatherAction = useAction(api.ai.getWeather);
  const getVideosAction = useAction(api.youtube.getVideos);
  const detectWeatherAction = useAction(api.ai.detectWeatherQuery);
  const indexMessagesAction = useAction(api.rag.indexMessages);
  const getCountryInfoAction = useAction(api.ai.getCountryInfo);
  const getOAuthStartUrlAction = useAction(api.cloudinary.getOAuthStartUrl);
  const disconnectCloudinaryAction = useAction(api.cloudinary.disconnectCloudinary);
  const getCanvaOAuthStartUrl = useAction(api.canva.getOAuthStartUrl);
  const disconnectCanvaAction = useAction(api.canva.disconnectCanva);
  const generateTitleAction = useAction(api.ai.generateTitle);
  const searchWebImagesAction = useAction(api.ai.searchWebImages);
  const extractPdfTextAction = useAction(api.ai.extractPdfText);
  const renameSessionMutation = useRenameSession();
  const setWebImagesMutation = useMutation(api.chats.setWebImages);
  const savePromptMutation = useMutation(api.chats.savePrompt);
  const deletePromptMutation = useMutation(api.chats.deletePrompt);
  const promptsList = useQuery(api.chats.listPrompts);

  // Cloudinary OAuth connection status (live query)
  const cloudinaryStatus = useQuery(api.cloudinaryOAuth.getStatus);
  const canvaStatus = useQuery(api.canvaOAuth.getStatus);

  const [input, setInput] = useState("");
  /**
   * The `/token` being typed, when the whole message so far is a command.
   *
   * Deliberately anchored to the start and to "no whitespace yet": a slash
   * halfway through a sentence is prose, and hijacking it would be worse than
   * having no menu at all.
   */
  const slashToken = useMemo(() => {
    const trimmed = input.trimStart();
    if (!trimmed.startsWith("/")) return "";
    if (/\s/.test(trimmed.slice(1))) return "";
    return trimmed;
  }, [input]);
  const slashOpen = slashToken.length > 0;
  const [sending, setSending] = useState(false);
  const [deepResearch, setDeepResearch] = useState(false);
  // Composer mode chips — arm News/Analyze for the next send (Gemini-style)
  const [modeNews, setModeNews] = useState(false);
  const [modeAnalyze, setModeAnalyze] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [showSounds, setShowSounds] = useState(false);
  const [showVoices, setShowVoices] = useState(false);
  const [showTranslate, setShowTranslate] = useState(false);
  // Voice + translation choices, persisted so they survive a reload.
  const [voicePref, setVoicePref] = useState<VoicePreference>(
    loadVoicePreference,
  );
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  // Per-message translations, shown beneath the original reply.
  const [translations, setTranslations] = useState<
    Record<string, { text: string; language: string; engine: string }>
  >({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [panelNlp, setPanelNlp] = useState<NlpResult | null>(null);
  const [panelNews, setPanelNews] = useState<NewsItem[] | null>(null);
  const [panelBusy, setPanelBusy] = useState<"nlp" | "news" | null>(null);
  const [panelVoice, setPanelVoice] = useState<VoiceNoteResult | null>(null);
  /**
   * How the last Deep Research run went, beyond the answer itself.
   *
   * A second search round only happens when the first left a real gap, so
   * reporting it is how the user learns the research looked for more than the
   * first page of results.
   */
  const [researchRounds, setResearchRounds] = useState(0);
  const [researchFollowUp, setResearchFollowUp] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingImages, setPendingImages] = useState<
    { url: string; publicId: string; provider?: string }[]
  >([]);
  // Several documents can ride along with one message; the old single slot
  // silently dropped everything but the first.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<Id<"chatMessages"> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [summarizingUrl, setSummarizingUrl] = useState(false);
  const [summarizeInput, setSummarizeInput] = useState("");
  const [regionTime, setRegionTime] = useState<string | null>(null);
  const [regionTimezone, setRegionTimezone] = useState(() => {
    try {
      return localStorage.getItem("jarvis-timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "UTC";
    }
  });
  const [countryCode, setCountryCode] = useState(() => {
    try {
      return localStorage.getItem("jarvis-country") || "IN";
    } catch {
      return "IN";
    }
  });

  // Live-translation target, seeded once. It lives down here because the default
  // depends on the selected country's language.
  const [translateTarget, setTranslateTarget] = useState<string>(() => {
    try {
      return (
        localStorage.getItem("jarvis-translate-target") ||
        getTranslateLanguage(getCountry(countryCode).langTag)?.code ||
        "hi-IN"
      );
    } catch {
      return "hi-IN";
    }
  });

  const changeCountry = (code: string) => {
    setCountryCode(code);
    const cfg = getCountry(code);
    setRegionTimezone(cfg.timezone);
    try {
      localStorage.setItem("jarvis-country", code);
      localStorage.setItem("jarvis-timezone", cfg.timezone);
    } catch {
      // ignore
    }
  };
  const [regionResult, setRegionResult] = useState<Record<string, unknown> | null>(null);
  const [regionBusy, setRegionBusy] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [cloudinaryConnecting, setCloudinaryConnecting] = useState(false);
  const [canvaConnecting, setCanvaConnecting] = useState(false);
  // Puter's session. Probed on mount so the UI can offer a real Connect
  // button; a signed-in user never sees the txt2img popup again.
  const [puterAuth, setPuterAuth] = useState<PuterSignInStatus>({
    signedIn: false,
    username: null,
  });
  const [puterConnecting, setPuterConnecting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getPuterSignInStatus()
      .then((status) => {
        if (!cancelled) setPuterAuth(status);
      })
      .catch(() => {
        /* best-effort probe; the Connect button loads the SDK on demand */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [showPrompts, setShowPrompts] = useState(false);
  // `countryCode` is already read this way, so the stored theme can be too —
  // seeding it lazily avoids a light-mode flash before the mount effect runs.
  const [isDark, setIsDark] = useState(() => {
    try {
      return localStorage.getItem("jarvis-theme") === "dark";
    } catch {
      return false;
    }
  });
  const { palette, setPalette } = usePalette();
  const [pdfBusy, setPdfBusy] = useState(false);
  // --- Feature panels: memory, export, camera, live translation ---
  const [showMemory, setShowMemory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showAeroTransform, setShowAeroTransform] = useState(false);

  // Writing-skill surfaced from a stored plugin into the code runner.
  const [selectedSkill, setSelectedSkill] = useState<{
    skillName: string;
    text: string;
    bytes: number;
  } | null>(null);
  const [skillCopied, setSkillCopied] = useState(false);

  // Writing-skill load state: which stored skill the runner is pulling in.
  const [loadingSkill, setLoadingSkill] = useState<{
    pluginId: Id<"plugins">;
    skillName: string;
  } | null>(null);
  const handleDismissLoadingSkill = useCallback(() => {
    setLoadingSkill(null);
  }, []);
  const clearLoadingSkill = handleDismissLoadingSkill;

  const clearSkill = useCallback(() => {
    setSelectedSkill(null);
    clearLoadingSkill();
  }, [clearLoadingSkill]);

  const insertSkill = useCallback(
    (skill: { skillName: string; text: string; bytes: number }) => {
      setSelectedSkill(skill);
    },
    [],
  );
  // The overview surface. Separate from Dev, like Claude's chat versus its code
  // view — one drives a run, the other reads the estate.
  const [showAeroOverview, setShowAeroOverview] = useState(false);
  const [aeroHandoffRunId, setAeroHandoffRunId] = useState<Id<"agentRuns"> | null>(
    null,
  );
  const [streaming, setStreaming] = useState(false);
  // True while a "continue" call is in flight, so the button cannot be
  // double-pressed into two continuations of the same reply.
  const [continuing, setContinuing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Which message is about to be deleted, for the confirm step.
  const [confirmDelete, setConfirmDelete] = useState<Id<"chatMessages"> | null>(null);
  // Latest-value refs for the key handler, which is registered once and must
  // not close over the first render's callbacks. Synced in an effect rather
  // than during render — writing a ref while rendering is what the
  // react-hooks/refs rule forbids.
  const streamingRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  // Camera vision is opt-in and off until the user asks for it: the hook
  // never calls getUserMedia on its own.
  const camera = useCamera();
  const liveTranslate = useLiveTranslation();

  // Long-term memory runs after each exchange, off the critical path.
  const extractMemory = useAction(api.memory.extract);

  // Editing and regenerating fork rather than delete; the original line of the
  // conversation stays reachable from the branch bar.
  const forkBranch = useMutation(api.branches.forkBranch);
  const createSessionMutation = useMutation(api.chats.createSession);
  const patchMessageContent = useMutation(api.chats.patchMessageContent);
  const requestStop = useMutation(api.chats.requestStop);
  const deleteMessageAndTail = useMutation(api.chats.deleteMessageAndTail);
  const continueReplyAction = useAction(api.ai.continueReply);
  // Streaming is on by default: for a long answer, seeing the first sentence
  // immediately is worth far more than the handful of ms it costs.
  const [streamReplies, setStreamReplies] = useState(true);
  const searchSessionsQuery = useQuery(
    api.chats.searchSessions,
    searchQuery.length >= 2 ? { query: searchQuery } : "skip",
  );
  const [uploadCount, setUploadCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lightbox, setLightbox] = useState<{
    images: string[];
    index: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- File upload: any type, signed upload to Cloudinary (multi) ----
  const uploadFile = async (
    file: File,
  ): Promise<{ url: string; publicId: string; resourceType: string } | null> => {
    try {
      const signed = await getSignedUploadUrl({ filename: file.name });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", signed.apiKey);
      formData.append("timestamp", String(signed.timestamp));
      formData.append("signature", signed.signature);
      formData.append("folder", signed.folder);
      formData.append("public_id", signed.publicId);

      const res = await fetch(signed.url, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Upload failed: ${err.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        secure_url: string;
        public_id: string;
        resource_type: string;
      };

      return {
        url: data.secure_url,
        publicId: data.public_id,
        resourceType: data.resource_type,
      };
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Upload failed.");
      return null;
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    // Reject oversized files before upload starts (25 MB per file)
    const MAX_FILE_BYTES = 25 * 1024 * 1024;
    const tooBig = files.filter((f) => f.size > MAX_FILE_BYTES);
    if (tooBig.length > 0) {
      setAssistantError(
        `${tooBig.map((f) => f.name).join(", ")} ${tooBig.length > 1 ? "exceed" : "exceeds"} the 25 MB limit.`,
      );
    }
    const acceptable = files.filter((f) => f.size <= MAX_FILE_BYTES);
    if (acceptable.length === 0) return;
    files = acceptable;
    setUploading(true);
    setUploadCount(acceptable.length);
    setAssistantError(null);
    try {
      const results = await Promise.all(acceptable.map((f) => uploadFile(f)));
      const images: { url: string; publicId: string; provider?: string }[] =
        [];
      const documents: PendingFile[] = [];

      results.forEach((r, i) => {
        if (!r) return;
        if (r.resourceType === "image") {
          images.push({ url: r.url, publicId: r.publicId });
        } else {
          documents.push({
            url: r.url,
            name: acceptable[i].name,
            type: acceptable[i].type || r.resourceType,
            size: acceptable[i].size,
          });
        }
      });

      if (images.length > 0) {
        setPendingImages((prev) => [...prev, ...images]);
      }
      if (documents.length > 0) {
        // Text-like files are read locally and inlined into the prompt, so
        // "what does this do?" works on a .ts file instead of only on a PDF.
        let budget = MAX_TOTAL_ATTACHMENT_TEXT;
        for (const document of documents) {
          const source = acceptable.find((f) => f.name === document.name);
          if (!source || !isTextLike(source) || budget <= 0) continue;
          try {
            const text = (await source.text()).slice(
              0,
              Math.min(MAX_ATTACHMENT_TEXT, budget),
            );
            document.text = text;
            budget -= text.length;
          } catch {
            // Unreadable file: it stays a link, which is still useful.
          }
        }
        setPendingFiles((prev) => [...prev, ...documents]);
      }
    } finally {
      setUploading(false);
      setUploadCount(0);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void uploadFiles(files);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void uploadFiles(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  // ---- AI image generation: Puter (primary) → Perchance → server chain ----
  // Puter runs first and in the browser, under its "user pays" model: it needs
  // no API keys, and running it immediately means its sign-in popup still has
  // the original click's user activation — browsers block popups that follow a
  // long fallback chain. Perchance is next (corsproxy's free tier only serves
  // browser requests); the server chain (Pollinations etc.) is the last resort.
  const generateImageSmart = async (
    prompt: string,
  ): Promise<{ url: string; publicId: string; provider: string }> => {
    // Collect every stage's reason, not just the last one. Reporting only the
    // final failure hid the Puter error — the one that actually explains why
    // the primary provider was skipped.
    const failures: string[] = [];
    try {
      return await generateImageWithPuter(prompt, uploadFile);
    } catch (err) {
      // Keep the real reason rather than erasing it: Puter rejects with codes
      // like `popup_blocked`, and the upload leg has its own message.
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`Puter: ${msg}`);
      console.warn("[image-gen] Puter.js failed, falling back:", msg);
      setAssistantError(null);
    }
    // No browser-side Perchance step: it required handing corsproxy and
    // perchance credentials to every signed-in client, and the server chain
    // below already runs Perchance (plus Pollinations and AI Horde) without
    // exposing a single key.
    try {
      return await generateImageAction({ prompt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`Server chain: ${msg}`);
      console.warn("[image-gen] server chain failed:", msg);
      // Newline-separated and accompanied by the page's own Puter facts: the
      // banner is the diagnostic, so it must not need DevTools to interpret.
      throw new Error(
        `Every image provider failed.\n${failures.join("\n")}\n${describePuterEnvironment()}`,
      );
    }
  };

  // Returns whether an image actually landed, so callers that auto-send can
  // tell a real generation from a failure.
  const generateImageWithPrompt = async (
    prompt: string,
  ): Promise<{ url: string; publicId: string; provider: string } | null> => {
    setGenerating(true);
    setAssistantError(null);
    try {
      const { url, publicId, provider } = await generateImageSmart(prompt);
      setPendingImages((prev) => [
        ...prev,
        { url, publicId, provider },
      ]);
      // Puter only loads once a generation actually reaches it. Now that the
      // SDK is present the probe can read the real session, so keep the
      // Connect label truthful after the first Puter-backed image.
      if (provider === "puter") {
        void getPuterSignInStatus().then(setPuterAuth);
      }
      inputRef.current?.focus();
      return { url, publicId, provider };
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Image generation failed.",
      );
      return null;
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateImage = async () => {
    const prompt = input.trim();
    if (!prompt || generating) return;
    setInput("");
    await generateImageWithPrompt(prompt);
  };

  // The Image Studio hands a finished picture over the same way a chat
  // generation does — as a pending attachment — rather than sending it. The
  // caption stays the user's to edit, and nothing ships until they press Send.
  const studioUseInChat = (
    image: { url: string; publicId: string; provider?: string },
    promptText: string,
  ) => {
    setPendingImages((prev) => [
      ...prev,
      { url: image.url, publicId: image.publicId, provider: image.provider },
    ]);
    setInput(promptText);
    window.setTimeout(() => inputRef.current?.focus(), 60);
  };

  // /image <prompt> — generate AND send as a message in one step
  const handleGenerateImageWithText = async (prompt: string) => {
    if (!prompt.trim() || generating) return;
    // Only caption the turn when an image actually landed. Sending anyway made
    // a failed generation look like a plain chat reply with no image at all.
    const generated = await generateImageWithPrompt(prompt);
    if (!generated) return;
    // Once attached, auto-send with the prompt as caption. The image is passed
    // explicitly: this timeout's closure was captured before the render that
    // populated pendingImages, so reading that state inside it yields the old
    // empty array and the turn ships as bare prompt text with no image.
    setTimeout(() => {
      void runSendWithText(prompt, [
        { url: generated.url, publicId: generated.publicId },
      ]);
    }, 100);
  };

  const [voiceOutput, setVoiceOutput] = useState(() => {
    try {
      return localStorage.getItem("jarvis-voice-output") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("jarvis-voice-output", String(voiceOutput));
    } catch {
      /* ignore */
    }
  }, [voiceOutput]);

  // --- Voice output ---
  const player = useVoicePlayer();

  // --- Engine routing, pins, comparison, listening -----------------------
  const setPin = useMutation(api.chats.setPin);
  // A verdict is a plain field on the reply — no encryption obligation, since
  // "good/bad" carries no content — so this one writes directly.
  const giveFeedback = useMutation(api.chats.setMessageFeedback);
  const setAlternative = useMutation(api.chats.setAlternative);
  const appendToBranch = useMutation(api.branches.appendToBranch);
  const convex = useConvex();
  const alternativeAnswer = useAction(api.ai.alternativeAnswer);
  const engineSettings = useQuery(api.workspace.getEngineSettings);

  const [showPins, setShowPins] = useState(false);
  const [showEngines, setShowEngines] = useState(false);
  const [showPlugins, setShowPlugins] = useState(false);
  const [showMcp, setShowMcp] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const runOpenSkill = useAction(api.plugins.applySkill);
  const handleOpenSkillFromDialog = useCallback(
    async (pluginId: Id<"plugins">, skillName: string) => {
      setLoadingSkill({ pluginId, skillName });
      try {
        const result = await runOpenSkill({ pluginId, skillName });
        if (result) {
          insertSkill({
            skillName: result.skillName,
            text: result.text,
            bytes: result.text.length,
          });
        }
      } finally {
        setLoadingSkill(null);
      }
    },
    [runOpenSkill, insertSkill],
  );

  const [showLivePanel, setShowLivePanel] = useState(false);
  /** Which reply's provenance card is open, if any. */
  const [inspecting, setInspecting] = useState<Id<"chatMessages"> | null>(null);
  /** A pinned message the transcript has just jumped to. */
  const [highlight, setHighlight] = useState<Id<"chatMessages"> | null>(null);

  // ---- Find in this conversation ------------------------------------------
  // ⌘F searches this transcript rather than the page: what is on screen is
  // decrypted in this tab, while the browser's own find would only ever see
  // the ciphertext underneath. Matches come from the same `messages` list the
  // transcript renders, and the current hit borrows the pinned-message flash
  // so it is still visible after the scroll lands.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const findMatches = useMemo(() => {
    const needle = findQuery.trim().toLowerCase();
    if (!findOpen || !needle) return [];
    return (messages ?? [])
      .filter((m) => m.content.toLowerCase().includes(needle))
      .map((m) => m._id);
  }, [findOpen, findQuery, messages]);

  // Modulo instead of a clamp effect: backspacing can shrink the list under
  // an index that is already past the end, and this keeps it valid on the
  // render that changed rather than one tick later.
  const findCount = findMatches.length;
  const findCurrent = findCount === 0 ? null : (findMatches[findIdx % findCount] ?? null);

  const openFind = useCallback(
    (seed?: string) => {
      setFindOpen(true);
      if (seed !== undefined) setFindQuery(seed);
      // After the bar paints, so the caret lands in the field.
      window.setTimeout(() => findInputRef.current?.focus(), 0);
    },
    [setFindOpen, setFindQuery],
  );

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindIdx(0);
    setHighlight(null);
  }, [setFindOpen, setFindQuery, setFindIdx, setHighlight]);

  const stepFind = useCallback(
    (dir: 1 | -1) => {
      if (findCount === 0) return;
      setFindIdx((prev: number) => (prev + dir + findCount) % findCount);
    },
    [findCount, setFindIdx],
  );

  // Jump to the current hit whenever the query or the index changes. Runs
  // only on the id — a reply streaming in does not move the row it is on.
  useEffect(() => {
    if (!findOpen || !findCurrent) return;
    const t = window.setTimeout(() => {
      setHighlight(findCurrent);
      document
        .querySelector<HTMLElement>(`[data-message-id="${findCurrent}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [findOpen, findCurrent]);

  const [slashIndex, setSlashIndex] = useState(0);
  const [compareState, setCompareState] = useState<{
    left: CompareSide;
    right: CompareSide;
  } | null>(null);
  const [comparingId, setComparingId] = useState<Id<"chatMessages"> | null>(null);

  /**
   * Read a whole thread aloud from any message.
   *
   * Shares the TTS action and voice preferences with the per-message play
   * button, so switching between the two cannot change which voice answers.
   */
  const listening = useListeningQueue({
    items: (messages ?? []).map((m) => ({
      id: m._id,
      role: m.role,
      content: m.content,
    })),
    speak: async (text) => {
      const { audio } = await speakAction({
        text,
        langTag: getCountry(countryCode).langTag,
        ...(voicePref.speaker ? { speaker: voicePref.speaker } : {}),
        ...(voicePref.voice ? { voice: voicePref.voice } : {}),
        ...(voicePref.pace !== 1 ? { pace: voicePref.pace } : {}),
      });
      return audio;
    },
    langTag: getCountry(countryCode).langTag,
  });

  // Pulled out of the hook result so the global key handler can depend on the
  // two things it actually reads. The object itself is new on every render, so
  // depending on it would re-register the listener on every keystroke.
  const listeningActive = listening.active;
  const stopListening = listening.stop;

  /** Jump to a pinned message: switch chat, scroll to it, flash it. */
  const openPinned = (
    sessionId: Id<"chatSessions">,
    messageId: Id<"chatMessages">,
  ) => {
    setShowPins(false);
    if (sessionId !== activeId) {
      setActiveId(sessionId);
      setActiveBranchId(null);
    }
    setHighlight(messageId);
    // A newly-opened chat renders its transcript a tick later, so the delay is
    // for that render rather than for any network work.
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 400);
    window.setTimeout(() => setHighlight(null), 2400);
  };

  const togglePin = useCallback(
    async (messageId: Id<"chatMessages">, pinned: boolean) => {
      try {
        await setPin({ messageId, pinned });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not pin that message.",
        );
      }
    },
    [setPin],
  );

  /**
   * Ask the same question again with the best *different* engine, and park the
   * result on its own branch.
   *
   * Forking at the original reply copies everything before it — the whole
   * question — and then adds nothing but the alternative answer. That is the
   * shape the compare view wants: two columns, one question, two answers.
   *
   * `getMessagesByIds` is not called here because the branch was just created
   * and the transcript has not caught up; the sides are handed over directly
   * instead. The badge on the reply reopens it through a query once the
   * transcript does know about the alternative.
   */
  const createDecisionBranch = useCallback(
    async (assistantId: Id<"chatMessages">) => {
      if (!activeId || comparingId) return;
      const list = messages ?? [];
      const index = list.findIndex((m) => m._id === assistantId);
      if (index < 0) return;
      const original = list[index];
      const question = [...list.slice(0, index)]
        .reverse()
        .find((m) => m.role === "user");
      if (!question || original.role !== "assistant") return;

      const images =
        original.images && original.images.length > 0
          ? original.images.map((i) => i.url)
          : original.imageUrl
            ? [original.imageUrl]
            : [];
      const history = list
        .slice(0, index)
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));

      setComparingId(assistantId);
      try {
        const result = await alternativeAnswer({
          prompt: question.content,
          ...(original.engineId
            ? { excludeEngineId: original.engineId }
            : {}),
          history,
          ...(images.length > 0 ? { imageUrls: images } : {}),
          ...(activePersonaId ? { personaId: activePersonaId } : {}),
        });

        if (!result.available || !result.text) {
          toast.error(
            result.reason ?? "No second engine is configured for this turn.",
          );
          return;
        }

        const branchId = await forkBranch({
          sessionId: activeId,
          atMessageId: assistantId,
          name: `Engine: ${result.model}`,
        });
        const { messageId: altId } = await appendToBranch({
          sessionId: activeId,
          branchId,
          role: "assistant",
          content: result.text,
          model: result.model,
          engineId: result.engineId,
          decisionReason: result.reason,
          latencyMs: result.latencyMs,
          isDecisionBranch: true,
        });
        await setAlternative({
          messageId: assistantId,
          altMessageId: altId,
          altBranchId: branchId,
        });

        setCompareState({
          left: {
            label: "Original",
            prompt: question.content,
            content: original.content,
            model: original.model,
            engineId: original.engineId,
            decisionReason: original.decisionReason,
            latencyMs: original.latencyMs,
          },
          right: {
            label: result.model ?? "Alternative",
            prompt: question.content,
            content: result.text,
            model: result.model,
            engineId: result.engineId,
            decisionReason: result.reason,
            latencyMs: result.latencyMs,
          },
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not compare engines.",
        );
      } finally {
        setComparingId(null);
      }
    },
    [
      activeId,
      activePersonaId,
      alternativeAnswer,
      appendToBranch,
      comparingId,
      forkBranch,
      messages,
      setAlternative,
      setCompareState,
    ],
  );

  /**
   * Reopen a comparison that already exists.
   *
   * The alternative lives on another branch, so it has to be fetched by id —
   * the transcript on screen will never contain it.
   */
  const openCompare = async (assistantId: Id<"chatMessages">) => {
    const list = messages ?? [];
    const original = list.find((m) => m._id === assistantId);
    if (!original?.altMessageId) return;
    const index = list.findIndex((m) => m._id === assistantId);
    const question = [...list.slice(0, index)]
      .reverse()
      .find((m) => m.role === "user");

    // A one-off read rather than a live query: the alternative only needs
    // reading when the user asks to compare, and a subscription would
    // re-read a message nobody is looking at.
    const found = await convex
      .query(api.chats.getMessagesByIds, { ids: [original.altMessageId] })
      .catch(() => null);
    const alt = found?.[0];
    if (!alt) {
      toast.error("That comparison is no longer available.");
      return;
    }

    setCompareState({
      left: {
        label: "Original",
        prompt: question?.content ?? null,
        content: original.content,
        model: original.model,
        engineId: original.engineId,
        decisionReason: original.decisionReason,
        latencyMs: original.latencyMs,
      },
      right: {
        label: alt.isDecisionBranch
          ? (alt.engineId ?? alt.model ?? "Alternative")
          : "Alternative",
        prompt: question?.content ?? null,
        content: alt.content,
        model: alt.model,
        engineId: alt.engineId,
        decisionReason: alt.decisionReason,
        latencyMs: alt.latencyMs,
      },
    });
  };

  /**
   * Answer the same question with the best different engine, when the user has
   * asked for that.
   *
   * Called from the send path rather than from an effect. An effect keyed on
   * the transcript would re-fire when the branch it just created shows up as a
   * message, and would have to be fenced off with a ref; calling it where the
   * reply is finished is both honest and impossible to loop.
   */
  const autoBranchAfter = useCallback(
    (messageId: Id<"chatMessages"> | null) => {
      if (!messageId || !engineSettings?.autoBranch) return;
      void createDecisionBranch(messageId);
    },
    [createDecisionBranch, engineSettings?.autoBranch],
  );

  const handleRecording = async (blob: Blob) => {
    setTranscribing(true);
    setAssistantError(null);
    setPanelVoice(null);
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = (await transcribeAction({
        audio: bytes.buffer,
      })) as VoiceNoteResult;
      setPanelVoice(result);
      setInput(result.text);
      inputRef.current?.focus();
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Transcription failed.",
      );
    } finally {
      setTranscribing(false);
    }
  };

  const recorder = useVoiceRecorder(handleRecording);

  // ---- Live mode: Whisper STT → chat pipeline → spoken reply ----
  const sound = useSoundEffects();

  // Persist the live-translation choice. The initial value is seeded lazily
  // above, so there is nothing to hydrate after mount.
  useEffect(() => {
    saveVoicePreference(voicePref);
  }, [voicePref]);

  useEffect(() => {
    try {
      localStorage.setItem("jarvis-translate-target", translateTarget);
    } catch {
      /* ignore */
    }
  }, [translateTarget]);

  /** Play a short sample in a candidate voice so the user picks by ear. */
  const previewVoice = async (
    key: string,
    prefs: { speaker?: string; voice?: string; pace?: number },
  ) => {
    if (previewingVoice) return;
    setPreviewingVoice(key);
    try {
      const { audio } = await speakAction({
        text: VOICE_PREVIEW_TEXT,
        langTag: getCountry(countryCode).langTag,
        ...prefs,
      });
      if (audio) {
        player.play(`preview-${key}`, audio);
      } else {
        // No server voice for this provider — fall back to the browser voice.
        const synth = window.speechSynthesis;
        if (synth) {
          synth.cancel();
          const utt = new SpeechSynthesisUtterance(VOICE_PREVIEW_TEXT);
          utt.lang = getCountry(countryCode).langTag;
          synth.speak(utt);
        }
      }
    } catch {
      setAssistantError("Could not preview that voice.");
    } finally {
      window.setTimeout(() => setPreviewingVoice(null), 400);
    }
  };
  // While the wake gate is on, live mode ignores any turn that doesn't start
  // with "Hey Jarvis" — so a passing conversation never becomes a command.
  const [wakeGate, setWakeGate] = useState(() => {
    try {
      return localStorage.getItem("jarvis-wake-gate") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("jarvis-wake-gate", String(wakeGate));
    } catch {
      /* ignore */
    }
  }, [wakeGate]);

  const liveTurnRef = useRef<(text: string) => Promise<void>>(async () => {});
  // Hand control for the orb. Off until asked for: it needs the camera, and
  // silently opening it during a voice call would be a surprise.
  const [orbGestures, setOrbGestures] = useState(false);
  // Rolling conversation shown on the full-screen JARVIS HUD (live voice call)
  const [liveTranscript, setLiveTranscript] = useState<LiveTurn[]>([]);
  // Voice inventory for the live-mode picker. Only the names and whether each
  // provider is configured — no key material, so it is safe to send to the
  // browser and needs no auth.
  const voiceOptions = useQuery(api.config.voiceOptions, {});
  const live = useLiveMode(
    async (audio: Blob, country: string) => {
      const lang = getCountry(country).language;
      const bytes = await audio.arrayBuffer();
      const { text: raw } = await transcribeWhisperAction({ audio: bytes, language: lang });
      if (!raw) return "";

      // Wake gate: drop the turn entirely unless it opened with the phrase.
      let text = raw;
      if (wakeGate) {
        const wake = stripWakeWord(raw);
        if (!wake.woke) return "";
        if (wake.onlyWake) {
          // "Hey Jarvis" on its own: chime and keep listening. No transcript
          // row — an empty turn would sit in the log as a blank gap, and the
          // next reply would attach to it instead of to a real question.
          playAckChime();
          return "";
        }
        text = wake.text;
        playAckChime();
      }

      // A sound request ("bark", "do a cat meow", "dog then cat then lion")
      // is answered with the actual sounds, not sentences about them. Wait for
      // the clips to finish, otherwise the recorder picks the bark up as the
      // user talking.
      const cues = findSoundCues(text);
      if (cues.length > 0) {
        // The clip is audio, not thinking: kill the hum or it drones under
        // the bark.
        stopThinkingHum();
        setLiveTranscript((t) => [
          ...t.slice(-5),
          { user: text, assistant: cueLine(cues) },
        ]);
        await sound.playCues(cues);
        return "";
      }

      // The user finished a statement → caption it immediately, then answer.
      setLiveTranscript((t) => [...t.slice(-5), { user: text, assistant: "" }]);
      // "Answer in my language" is appended to the turn itself, so the whole
      // reply is written in the target language rather than translated after.
      const directive = liveTranslate.promptDirective(translateTarget);
      // The detected mood is deliberately NOT appended to the prompt. This
      // turn is persisted as the user's message, so any tone note would end up
      // saved in the transcript and re-sent as history on later turns. It
      // drives the voice instead (see useLiveMode), which is where a coarse
      // prosodic read belongs anyway.
      await liveTurnRef.current(directive ? `${text}${directive}` : text);
      return text;
    },
    countryCode,
    voicePref,
    // Only override the speaking language when the user has asked for the
    // reply to be spoken in another language.
    liveTranslate.speakTranslated ? translateTarget : null,
  );
  // Gestures drive Jarvis, not the visuals — pinch-to-spin and two-hand zoom
  // are handled inside the tracker itself. These are the deliberate, one-shot
  // actions, each confirmed through the gesture arbiter before it arrives.
  const handleOrbGesture = useCallback(
    (action: GestureAction) => {
      switch (action) {
        case "interrupt":
          live.skipSpeaking();
          break;
        case "toggle_listening":
          // A clap is the one gesture that works with no touching at all.
          live.toggleMute();
          toast.success(live.muted ? "Jarvis is switched off." : "Jarvis is listening.");
          break;
        case "new_chat":
          setActiveId(null);
          break;
        case "pause_listening":
        case "resume_listening":
          // Live mode is hands-free by design: pausing the mic mid-call would
          // leave no way to talk without reaching for the mouse.
          toast.info("Live mode keeps listening — say anything, or tap Skip.");
          break;
        default:
          break;
      }
    },
    [live],
  );
  // Speak each new assistant reply when live mode is active. Streaming means
  // the row grows in place, so wait for generation to finish before speaking
  // — otherwise Jarvis would read a half-written sentence.
  const spokenReplyRef = useRef<Id<"chatMessages"> | null>(null);
  useEffect(() => {
    if (!live.active || !messages || messages.length === 0 || sending || streaming) return;
    const last = messages[messages.length - 1];
    if (!last.content.trim()) return;
    if (last.role === "assistant" && spokenReplyRef.current !== last._id) {
      spokenReplyRef.current = last._id;
      setLiveTranscript((turns) => {
        const next = turns.slice();
        const open = next[next.length - 1];
        if (open && !open.assistant) next[next.length - 1] = { ...open, assistant: last.content };
        else next.push({ user: "", assistant: last.content });
        return next.slice(-5);
      });
      // With speech translation on, the HUD keeps the original text (so you
      // can read it) while the audio is in the chosen language.
      void liveTranslate
        .forSpeech(last.content, translateTarget)
        .then((spoken) => live.deliverReply(spoken))
        .catch(() => live.deliverReply(last.content));
    }
  }, [messages, sending, streaming, live, liveTranslate, translateTarget]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMsg = messages?.[messages.length - 1];

  // Smart auto-scroll: stick to the bottom while the reply streams, but never
  // yank the page away if the user scrolled up to read — a jump-to-latest
  // pill appears instead.
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (atBottom) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages?.length, sending, atBottom]);

  // Auto-speak new assistant replies when voice output is enabled
  const prevMsgCount = useRef(messages?.length ?? 0);
  useEffect(() => {
    const count = messages?.length ?? 0;
    if (voiceOutput && count > prevMsgCount.current && !sending) {
      const newest = messages![count - 1];
      if (
        newest.role === "assistant" &&
        !player.playingId &&
        !player.loadingId
      ) {
        // `handleSpeak` is declared further down the component; the effect body
        // only runs after the whole function has evaluated, so this is safe.
        // eslint-disable-next-line react-hooks/immutability
        void handleSpeak(newest._id, newest.content);
      }
    }
    prevMsgCount.current = count;
    // Deliberately narrow deps: this must fire once per *new* message, not on
    // every change to the player or the message objects. `handleSpeak` is
    // declared further down and is safe to call from the effect body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages?.length, sending, voiceOutput]);

  // Switching chats must clear every per-chat panel. This is a deliberate
  // "reset on id change" — deriving it from `activeId` would remount the whole
  // composer instead, and `player` is a stable controller object.
  /* eslint-disable react-hooks/set-state-in-effect -- deliberate reset on chat change */
  useEffect(() => {
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    setPendingImages([]);
    setPendingFiles([]);
    setEditingId(null);
    setActiveBranchId(null);
    setRegionResult(null);
    setShowCalculator(false);
    setFollowUps([]);
    player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keyboard shortcuts: Ctrl/Cmd+K opens the command palette, "/" focuses the
  // input (when not already typing), "?" lists every shortcut, and Esc stops a
  // reply mid-stream.
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return (
        el?.tagName === "TEXTAREA" ||
        el?.tagName === "INPUT" ||
        (el as HTMLElement | null)?.isContentEditable === true
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        setSidebarOpen(false);
        return;
      }

      // ⌘F finds inside this conversation instead of the page — see the find
      // bar above the transcript for why the browser's find cannot be used.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        openFind();
        return;
      }

      // Escape stops generation — but only before anything else has claimed
      // it. Closing an open dialog should close the dialog, not kill the reply
      // behind it, so this is deliberately last and checked against live mode,
      // which installs its own Escape handler and owns the key while it is up.
      if (e.key === "Escape") {
        // The find bar claims Escape first: it sits above the transcript and
        // its field may not even hold focus when the key is pressed.
        if (findOpen) {
          e.preventDefault();
          closeFind();
          return;
        }
        // Reading a thread is the one thing running that has no visible
        // "stop" affordance in the transcript, so Escape has to cover it.
        if (listeningActive) {
          e.preventDefault();
          stopListening();
          return;
        }
        if (!live.active && streamingRef.current) {
          e.preventDefault();
          void stopRef.current();
        }
        return;
      }

      if (typing()) return;

      if (e.key === "?" && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }
      if (
        e.key === "/" &&
        !(e.ctrlKey || e.metaKey || e.altKey)
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live.active, listeningActive, stopListening, findOpen, openFind, closeFind]);

  // Refresh displayed time every second
  useEffect(() => {
    const tick = () => {
      try {
        setRegionTime(
          new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: regionTimezone,
          }),
        );
      } catch {
        setRegionTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [regionTimezone]);

  // Persist timezone
  useEffect(() => {
    try {
      localStorage.setItem("jarvis-timezone", regionTimezone);
    } catch { /* ignore */ }
  }, [regionTimezone]);

  // Edit a user message: load it into the composer. The send that follows forks
  // the conversation at this message instead of deleting everything after it.
  const handleEditMessage = async (msgId: Id<"chatMessages">, content: string) => {
    setEditingId(msgId);
    setInput(content);
    inputRef.current?.focus();
  };

  /**
   * Regenerate a reply.
   *
   * Forks just before the reply being replaced and asks again on the new
   * branch, so a worse regeneration costs nothing: the original answer is still
   * there, one click away in the branch bar.
   */
  const handleRegenerate = async (assistantId: Id<"chatMessages">) => {
    if (!activeId || sending) return;
    const list = messages ?? [];
    const index = list.findIndex((m) => m._id === assistantId);
    if (index < 0) return;
    const prompt = [...list.slice(0, index)].reverse().find((m) => m.role === "user");
    if (!prompt) return;

    const history = list
      .slice(0, index)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    setSending(true);
    setAssistantError(null);
    try {
      const branchId = await forkBranch({
        sessionId: activeId,
        atMessageId: prompt._id,
      });
      setActiveBranchId(branchId);
      const answer = await runAsk(prompt.content, history);
      await appendMessage({
        sessionId: activeId,
        branchId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        engineId: answer.engineId,
        decisionReason: answer.reason,
        latencyMs: answer.latencyMs,
        promptTokens: answer.promptTokens,
        completionTokens: answer.completionTokens,
        usedFallback: answer.usedFallback,
        usedSearch: false,
      });
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Regeneration failed.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /** Fork from the newest user message — "try a different direction". */
  const handleForkLatest = async () => {
    if (!activeId) return;
    const latestUser = [...(messages ?? [])].reverse().find((m) => m.role === "user");
    if (!latestUser) return;
    try {
      const branchId = await forkBranch({
        sessionId: activeId,
        atMessageId: latestUser._id,
      });
      setActiveBranchId(branchId);
      setInput(latestUser.content);
      inputRef.current?.focus();
      toast.success("Branched — the original conversation is untouched.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not branch.");
    }
  };

  // ---- Natural-language weather: store user msg, fetch data, AI narrates ----
  /**
   * Answer a turn that contains a YouTube link.
   *
   * The transcript is fetched first and handed to the model as reference data,
   * so the reply is based on what was actually said rather than on the title.
   * When the transcript cannot be read the model is told so explicitly and
   * asked to say what it does and does not know, which is the only safe
   * response when the content itself is unavailable.
   */
  const runYouTubeReply = async (urls: string[], originalText: string) => {
    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    if (recorder.recording) recorder.stop();
    setInput("");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const batch = await getVideosAction({ urls });
      // With several videos the user is almost always after the comparison,
      // so that is what gets asked for. A single link still reads naturally.
      const multi = batch.videos.length > 1;

      // Only the videos that were actually read are worth asking about, and the
      // model is told which ones are missing so it cannot paper over the gap.
      const readable = batch.videos.filter((v) => !v.transcriptUnavailable);
      const unreadable = batch.videos.filter((v) => v.transcriptUnavailable);

      // Say plainly what could not be read, rather than leaving a hole the
      // model quietly fills with an assumption.
      const gapNote =
        unreadable.length > 0
          ? `\n\nNote: Jarvis could not obtain a transcript for Video ${
              unreadable.map((v) => v.index).join(", Video ")
            }. Do not describe the contents of those videos, and do not guess to fill the ` +
            `gap — say which ones you could not read.`
          : "";
      const skippedNote =
        batch.skipped > 0
          ? `\n\n${batch.skipped} further link${batch.skipped === 1 ? " was" : "s were"} ` +
            `ignored because only the first ${MAX_VIDEOS_PER_TURN} videos in a message are read.`
          : "";

      const instruction =
        batch.readableCount === 0
          ? `The user shared ${multi ? `${batch.videos.length} YouTube videos` : "a YouTube video"}, ` +
            `but no transcript could be obtained for any of them. You have only titles and ` +
            `channels below. Tell the user what you can from those — the likely subject of each ` +
            `video and its channel — and be brief and honest that you could not read or watch ` +
            `them. Do not summarise content you have not seen.` +
            `\n\nA question about WHO or WHICH CHANNEL the video is from is answered directly ` +
            `by the Title and Channel fields below — answer it from those even without a ` +
            `transcript. Likewise for "what is this video called".\n\n${batch.context}`
          : multi
            ? `The user shared ${readable.length} YouTube video${readable.length === 1 ? "" : "s"} ` +
              `and wants them compared. Read every transcript below, then answer what they asked. ` +
              `\n\nStructure it as: (1) a one-line take on each video, naming which Video number ` +
              `it is, (2) where they agree, (3) where they genuinely differ or contradict each ` +
              `other, and (4) the most useful takeaway.\n\nRules that matter: attribute every ` +
              `claim to the video it came from, using the Video numbers above — a claim attached ` +
              `to the wrong video is worse than no claim. If they do not actually disagree, say ` +
              `so plainly rather than inventing a difference. Distinguish a real disagreement ` +
              `from two videos covering different topics. If a transcript was cut off, do not ` +
              `claim to know how that video ends. Each video's channel is in its header, ` +
              `so answer "who made this" per video rather than ignoring it. Keep it readable — ` +
              `short paragraphs or bullets, not an essay.${gapNote}${skippedNote}\n\n${batch.context}`
            : `The user shared a YouTube video. Respond to what they actually asked, drawing on ` +
              `what was said in it. If they asked a specific question, answer it from the ` +
              `transcript. Otherwise react to the content the way a person who just watched it ` +
              `would — comment on the substance, not on the fact that you were given a ` +
              `transcript. Cite a timestamp when you refer to a specific moment. If the ` +
              `transcript was cut off, do not claim to know how the video ends.${gapNote}${skippedNote}` +
              `\n\nIf they asked who the channel or speaker is, or what the video is called, ` +
              `answer straight from the Title and Channel fields in the data below — do not ` +
              `say you cannot tell them when it is written there.` +
              `\n\n${batch.context}`;

      const narration = await askAction({
        prompt: `The user said: "${originalText}"\n\n${instruction}`,
        history,
      });

      await appendMessage({
        sessionId,
        role: "assistant",
        content: narration.text,
        model: narration.model,
        usedFallback: narration.usedFallback,
        usedSearch: false,
      });
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Could not read that video.",
      );
    } finally {
      setSending(false);
    }
  };

  const runWeatherReply = async (city: string, originalText: string) => {
    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    if (recorder.recording) recorder.stop();
    setInput("");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const w = await getWeatherAction({ city });

      const narration = await askAction({
        prompt:
          `The user asked: "${originalText}"\n\n` +
          `Live weather data for ${w.city}${w.country ? ", " + w.country : ""} (via ${w.provider}):\n` +
          `- Condition: ${w.description} ${w.icon}\n- Temperature: ${w.temp}°C (feels like ${w.feelsLike}°C)\n` +
          (w.high !== undefined && w.low !== undefined ? `- Today's range: ${w.low}°C to ${w.high}°C\n` : "") +
          `- Humidity: ${w.humidity}%\n- Wind: ${w.wind} km/h\n` +
          (w.pressure !== undefined ? `- Pressure: ${w.pressure} hPa\n` : "") +
          (w.visibility !== undefined ? `- Visibility: ${w.visibility} km\n` : "") +
          (w.sunrise ? `- Sunrise: ${w.sunrise}, Sunset: ${w.sunset}\n` : "") +
          `\nAnswer the user's question naturally in 2-4 short sentences using this data. ` +
          `Include the temperature and condition. Add one practical suggestion (umbrella, jacket, etc.) if relevant. ` +
          `Do NOT mention slash commands, APIs, or that you were given structured data.`,
        history,
      });

      await appendMessage({
        sessionId,
        role: "assistant",
        content: narration.text,
        model: narration.model,
        usedFallback: narration.usedFallback,
        usedSearch: false,
      });

      // Also show the visual weather card
      setRegionResult({ type: "weather", ...w } as Record<string, unknown>);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Weather lookup failed.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };


  // ---- Real photographs: "images of X" answered with actual pictures ----
  //
  // The model cannot open a live gallery — it has no browser — so its honest
  // answer is a list of links telling the user where to go look, which is the
  // answer nobody wanted. The search happens here instead, and the pictures
  // become the reply.
  const runWebImageSearchMessage = async (
    query: string,
    originalText: string,
  ) => {
    setSending(true);
    setAssistantError(null);
    setInput("");
    if (recorder.recording) recorder.stop();

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const { images } = await searchWebImagesAction({ query });

      if (images.length > 0) {
        // Fetched before the reply is written, because here the images ARE
        // the answer — unlike generation, where they decorate a reply that
        // has already landed on screen.
        const replyId = await appendMessage({
          sessionId,
          role: "assistant",
          content: `Photos of **${query}** — real images found on the web. Each one opens the page it came from.`,
          model: "web-images",
        });
        await setWebImagesMutation({ messageId: replyId, images });
        return;
      }

      // Nothing came back: no key, quota spent, or genuinely nothing out
      // there. An empty strip would read as broken, so the turn falls through
      // to the model and the user still gets somewhere to look.
      const answer = await askAction({
        prompt:
          `The user asked for images of "${query}", but a web image search returned no results. ` +
          `Reply with the best places to find them — name the sites and link them — and keep it to a few lines.`,
        history,
      });
      await appendMessage({
        sessionId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        usedFallback: answer.usedFallback,
      });
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Image search failed.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // ---- Natural-language image gen: stores msg, generates, sends result ----
  const runImageGenerationMessage = async (prompt: string, originalText: string) => {
    setSending(true);
    setAssistantError(null);
    setInput("");
    if (recorder.recording) recorder.stop();

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
        history = (messages ?? []).slice(-12).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      setGenerating(true);
      let generated: { url: string; publicId: string; provider: string } | null = null;
      let genError: string | null = null;
      try {
        generated = await generateImageSmart(prompt);
      } catch (err) {
        genError = err instanceof Error ? err.message : "Image generation failed.";
      }
      setGenerating(false);

      // Attach the generated image and send it as an assistant message
      if (generated) {
        const generatedMessageId = await appendMessage({
          sessionId,
          role: "assistant",
          content: `Generated image: **${prompt}**`,
          model: generated.provider.startsWith("hf/") ? "huggingface" : generated.provider,
          imageUrl: generated.url,
          imagePublicId: generated.publicId,
          images: [{ url: generated.url, publicId: generated.publicId }],
        });
        // Also show what already exists on the web for the same prompt, each
        // linked to the page it came from. Deliberately detached: the
        // generation has already landed on screen, and making the user wait
        // on a second network call would cost more than the strip is worth.
        void searchWebImagesAction({ query: prompt })
          .then(({ images }) =>
            images.length > 0
              ? setWebImagesMutation({ messageId: generatedMessageId, images })
              : null,
          )
          .catch(() => {});
      } else {
        // All providers failed — have the LLM acknowledge gracefully
        const answer = await askAction({
          prompt: `The user asked me to generate an image of "${prompt}" but the image service failed (${genError}). Apologize briefly and suggest they try again or rephrase.`,
          history,
        });
        await appendMessage({
          sessionId,
          role: "assistant",
          content: answer.text,
          model: answer.model,
          usedFallback: answer.usedFallback,
        });
      }
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Image message failed.");
    } finally {
      setGenerating(false);
      setSending(false);
      inputRef.current?.focus();
    }
  };

  /**
   * Answer a sound request with the sound itself. The clip is generated once
   * per prompt and cached server-side, so repeating the request is instant.
   */
  const runSoundEffectMessage = async (
    cues: SoundCue[],
    originalText: string,
  ) => {
    setSending(true);
    setAssistantError(null);
    setInput("");
    if (recorder.recording) recorder.stop();

    try {
      let sessionId: Id<"chatSessions">;
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({ content: originalText });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({ sessionId, role: "user", content: originalText });
      }

      setGenerating(true);
      const played = await sound.playCues(cues);
      setGenerating(false);

      // A bare "bark" needs no prose; a chain is unambiguously a sound
      // request; a question that merely mentions the sound still deserves an
      // answer from the model.
      const onlySounds =
        isSoundOnlyRequest(originalText) || cues.length > 1;
      const reply = played
        ? onlySounds
          ? cueLine(cues, true)
          : `${cues[0].emoji}  That was a real ${cues[0].label.toLowerCase()} — a language model can only describe the sound, so I generated it.`
        : `I couldn't generate that sound right now${sound.error ? ` — ${sound.error}` : ""}.`;

      await appendMessage({
        sessionId,
        role: "assistant",
        content: reply,
        model: "elevenlabs-sound-effects",
      });
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Sound effect failed.");
    } finally {
      setGenerating(false);
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const runSendWithText = async (
    overrideText?: string,
    overrideImages?: { url: string; publicId: string }[],
  ) => {
    const text = (overrideText ?? input).trim();

    // Nothing is written until the key exists. The server refuses an
    // unencrypted turn anyway, so failing here is both the honest answer and
    // the cheap one — the user gets the prompt instead of a stack trace.
    if (!e2eKey && keyMaterial !== undefined) {
      setPassphraseOpen(keyMaterial ? "unlock" : "setup");
      return;
    }

    // Single source of truth for "what images belong to this turn". Callers
    // that generated an image moments ago pass it in, because their closure
    // predates the render that populated pendingImages.
    const imagesForTurn = overrideImages ?? pendingImages;
    // A turn is sendable if it has text, an attachment, OR the camera is on
    // and the user wants Jarvis to look at what's in front of them.
    const hasCamera = camera.enabled;
    if ((!text && imagesForTurn.length === 0 && pendingFiles.length === 0 && !hasCamera) || sending)
      return;
    if (text.length > 8000) {
      setAssistantError("Message too long — keep it under 8,000 characters.");
      return;
    }

    // PDF attachments route through the document-Q&A flow (extract text + ask)
    if (pendingFiles.some((f) => /pdf/.test(f.type)) && !editingId) {
      setInput("");
      await handlePdfQuestion(text);
      return;
    }

    // Country persona: Jarvis speaks the user's language & regional context.
    // Skipped when there is no text at all (camera-only turn) — appending a
    // persona to an empty string would just be a stray instruction.
    const countryPersona = getCountry(countryCode).persona;
    let effectiveText =
      !text || editingId || deepResearch || imagesForTurn.length > 0 || pendingFiles.length > 0
        ? text
        : `${text}\n\n[System: ${countryPersona}]`;

    // Files the model can actually read get inlined, so "what does this do?"
    // works on a .ts file and not just on a PDF.
    const fileContext = attachmentPrompt(pendingFiles);
    if (fileContext) {
      effectiveText = [effectiveText, fileContext].filter(Boolean).join("\n\n");
    }

    // Sound effects: "bark", "play a dog sound", "what does a cat say" —
    // answered with the real audio, which is the one thing a text model
    // cannot do for itself.
    const soundCues = findSoundCues(text);
    if (!editingId && soundCues.length > 0 && pendingFiles.length === 0) {
      await runSoundEffectMessage(soundCues, text);
      return;
    }

    // Real photographs from the web: "photos of Robert Downey Jr." Checked
    // before generation because the two are one word apart — "show me images
    // of X" asks for real ones, while "make an image of X" asks for art.
    if (!editingId && text && imagesForTurn.length === 0 && pendingFiles.length === 0 && !deepResearch) {
      const webImageQuery = findWebImageQuery(text);
      if (webImageQuery) {
        await runWebImageSearchMessage(webImageQuery, text);
        return;
      }
    }

    // Natural-language image generation: "generate an image of..." etc.
    if (!editingId && text && imagesForTurn.length === 0 && pendingFiles.length === 0 && !deepResearch) {
      const imgIntent = text.match(
        /^\s*(?:hey\s+|hi\s+|ok(?:ay)?[,\s]+)?(?:jarvis[,\s]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:gen(?:erate|rate|arate)|create|make|draw|paint|render|show|give)\s+(?:me\s+)?(?:an?|the)??\s*(?:ai\s+)?(?:image|picture|photo|artwork|drawing|painting|illustration|pic)s?\s*(?:of|showing|with|about|for)?\s*[:]?\s*([\s\S]{3,400})/i,
      );
      if (imgIntent?.[1]) {
        const prompt = imgIntent[1].replace(/[.?!]+$/, "").trim();
        await runImageGenerationMessage(prompt, text);
        return;
      }
    }

    // A YouTube link in the message. Placed after the attachment and sound
    // handlers so those keep priority when a message contains more than one
    // thing, and before the generic chat path so the transcript reaches the
    // model instead of only the bare link.
    if (!editingId && text && imagesForTurn.length === 0 && pendingFiles.length === 0 && !deepResearch) {
      const videoLinks = findYouTubeLinks(text);
      if (videoLinks.length > 0) {
        // Every link is passed along, so several can be compared; the action
        // applies the cap and reports what it dropped.
        await runYouTubeReply(
          videoLinks.map((r) => r.url),
          text,
        );
        return;
      }
    }

    // Natural-language weather: fetch live data directly, no slash command needed
    if (!editingId && text && imagesForTurn.length === 0 && pendingFiles.length === 0) {
      try {
        const detection = await detectWeatherAction({ message: text });
        if (detection.isWeather && detection.city) {
          await runWeatherReply(detection.city, text);
          return;
        }
        if (detection.isWeather && !detection.city) {
          // Weather asked but no city parsed — use detected timezone city guess
          const guess = regionTimezone.split("/").pop()?.replace(/_/g, " ") ?? "";
          if (guess) {
            await runWeatherReply(guess, text);
            return;
          }
        }
      } catch {
        // detection is best-effort — fall through to normal AI chat
      }
    }

    setSending(true);
    setAssistantError(null);
    setPanelNlp(null);
    setPanelNews(null);
    setPanelVoice(null);
    if (recorder.recording) recorder.stop();

    const hasImages = imagesForTurn.length > 0;
    const imagePayload = hasImages
      ? {
          images: imagesForTurn.map((img) => ({
            url: img.url,
            publicId: img.publicId,
          })),
          // Back-compat single fields for the first image
          imageUrl: imagesForTurn[0].url,
          imagePublicId: imagesForTurn[0].publicId,
        }
      : undefined;
    const attachments = pendingFiles.map((f) => ({
      url: f.url,
      name: f.name,
      type: f.type,
      size: f.size,
      text: f.text,
    }));
    // The legacy single-file fields still describe the first document, so rows
    // written by older builds (and every export) keep rendering.
    const firstFile = attachments[0];
    const filePayload = firstFile
      ? {
          fileUrl: firstFile.url,
          fileName: firstFile.name,
          fileType: firstFile.type,
          fileSize: firstFile.size,
        }
      : undefined;
    setPendingImages([]);
    setPendingFiles([]);
    setInput("");

    // Grab the camera frame once, here, so the streaming and non-streaming
    // paths see the exact same image and the saved transcript can say
    // something meaningful even when the user only pointed the camera.
    const cameraFrame = hasCamera ? camera.capture() : null;

    const messageContent =
      text ||
      (hasImages
        ? "[Image]"
        : filePayload
          ? `[File: ${filePayload.fileName}]`
          : cameraFrame
            ? "[Camera]"
            : "");

    try {
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      let userMsgId: Id<"chatMessages"> | undefined;
      // Every write in this turn lands on the same line of the conversation.
      let runBranchId: Id<"chatBranches"> | null = activeBranchId;

      if (editingId) {
        // Editing forks. The original conversation survives intact, so changing
        // two words in a prompt three turns back can never cost the user an
        // answer they had already read.
        const baseSessionId =
          activeId ?? (await createSessionMutation({ title: "New chat" }));
        if (!activeId) setActiveId(baseSessionId);
        runBranchId = await forkBranch({
          sessionId: baseSessionId,
          atMessageId: editingId,
        });
        setActiveBranchId(runBranchId);
        sessionId = baseSessionId;
        userMsgId = await appendMessage({
          sessionId,
          branchId: runBranchId,
          role: "user",
          content: messageContent,
          ...imagePayload,
          ...filePayload,
          attachments,
        });
        setEditingId(null);
        history = (messages ?? [])
          .filter((m) => m._id !== editingId)
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }));
      } else if (!activeId) {
        const { sessionId: sid, messageId: uid } = await startWithMessage({
          content: messageContent,
          ...imagePayload,
          ...filePayload,
          attachments,
          personaId: activePersonaId ?? undefined,
        });
        sessionId = sid;
        userMsgId = uid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        userMsgId = await appendMessage({
          sessionId,
          branchId: runBranchId,
          role: "user",
          content: messageContent,
          ...imagePayload,
          ...filePayload,
          attachments,
        });
        history = (messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      // Strip the "SUGGEST: a, b, c" trailer off the reply: the items become
      // clickable follow-up chips and the raw line never enters the saved
      // message (so it can never render as literal text).
      const extractFollowUps = (raw: string): string => {
        const m = raw.match(/^SUGGEST:\s*(.+)$/im);
        if (!m) {
          setFollowUps([]);
          return raw;
        }
        const items = m[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        setFollowUps(items);
        return raw.replace(/^SUGGEST:\s*.+$/im, "").trimEnd();
      };

      let answerText = "";
      if (deepResearch) {
        const { answer, sources, rounds, followUp } = await runDeepResearch(
          sessionId,
          text,
          history,
        );
        answerText = extractFollowUps(answer.text);
        // The gap-filling round is only worth reporting when it happened:
        // showing "2 searches" on a run that only made one would be a lie.
        setResearchRounds(rounds);
        setResearchFollowUp(followUp);
        const msgId = await appendMessage({
          sessionId,
          branchId: runBranchId,
          role: "assistant",
          content: answerText,
          model: answer.model,
          engineId: answer.engineId,
          decisionReason: answer.reason,
          latencyMs: answer.latencyMs,
          promptTokens: answer.promptTokens,
          completionTokens: answer.completionTokens,
          usedFallback: answer.usedFallback,
          usedSearch: true,
          sources,
        });
        void indexForRag(sessionId, userMsgId, msgId, messageContent, answerText).catch(() => {});
        extractMemories(messageContent, answerText);
      } else {
        const visionUrls = imagePayload?.images?.map((i) => i.url);
        // With streaming on, the assistant row is created empty and filled in
        // token by token, so the user starts reading before the model is done.
        if (streamReplies) {
          const allVision = cameraFrame
            ? [...(visionUrls ?? []), cameraFrame]
            : visionUrls;
          const answer = await runAskStreamed(
            sessionId,
            effectiveText,
            history,
            allVision && allVision.length > 0 ? allVision : undefined,
            runBranchId,
          );
          answerText = extractFollowUps(answer.text);
          // The streamed text still carries the SUGGEST trailer — rewrite the
          // saved row so the raw line never shows up in the transcript.
          if (answerText !== answer.text) {
            await patchMessageContent({
              messageId: streamedMessageIdRef.current!,
              content: answerText,
            }).catch(() => {});
          }
          autoBranchAfter(streamedMessageIdRef.current);
          void indexForRag(
            sessionId,
            userMsgId,
            streamedMessageIdRef.current!,
            messageContent,
            answerText,
          ).catch(() => {});
        } else {
          // Non-streaming still gets the camera frame, so toggling streaming
          // off must not silently blind Jarvis.
          const allVision = cameraFrame
            ? [...(visionUrls ?? []), cameraFrame]
            : visionUrls;
          const answer = await runAsk(
            effectiveText,
            history,
            allVision && allVision.length > 0 ? allVision : undefined,
          );
          answerText = extractFollowUps(answer.text);
          const msgId = await appendMessage({
            sessionId,
            branchId: runBranchId,
            role: "assistant",
            content: answerText,
            model: answer.model,
            engineId: answer.engineId,
            decisionReason: answer.reason,
            latencyMs: answer.latencyMs,
            promptTokens: answer.promptTokens,
            completionTokens: answer.completionTokens,
            usedFallback: answer.usedFallback,
            usedSearch: false,
          });
          autoBranchAfter(msgId);
          void indexForRag(sessionId, userMsgId, msgId, messageContent, answerText).catch(() => {});
        }
        extractMemories(messageContent, answerText);
      }
    } catch (err) {
      // A missing passphrase arrives as a sentinel, not a stack trace: open
      // the gate rather than printing an error the user cannot act on.
      if (err instanceof Error && err.message === PASSPHRASE_REQUIRED) {
        setPassphraseOpen(keyMaterial ? "unlock" : "setup");
        setSending(false);
        return;
      }
      setAssistantError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };


  // ---- RAG indexing: embed an exchange so future questions can recall it ----
  const indexForRag = async (
    sessionId: Id<"chatSessions">,
    userMsgId: Id<"chatMessages"> | undefined,
    assistantMsgId: Id<"chatMessages">,
    userContent: string,
    assistantContent: string,
  ) => {
    const messages: {
      messageId: Id<"chatMessages">;
      role: string;
      content: string;
    }[] = [];
    if (userMsgId && userContent) {
      messages.push({ messageId: userMsgId, role: "user", content: userContent });
    }
    if (assistantMsgId && assistantContent) {
      messages.push({
        messageId: assistantMsgId,
        role: "assistant",
        content: assistantContent,
      });
    }
    if (messages.length === 0) return;
    await indexMessagesAction({ sessionId, messages });
  };

  const runSend = () => runSendWithText();
  // Live mode holds a long-lived callback; keep it in step with the newest
  // runSendWithText without writing to a ref during render.
  useEffect(() => {
    liveTurnRef.current = async (text: string) => {
      await runSendWithText(text);
    };
  });

  // ---- Streaming replies ------------------------------------------------
  // The assistant message is created empty, then the action writes each token
  // batch into it. The live `useQuery(listMessages)` re-renders on every
  // patch, so the reply types itself in with no client-side buffering.
  // Returns the result plus the id of the row that was streamed into, so the
  // caller can patch the SUGGEST trailer out afterwards.
  const streamedMessageIdRef = useRef<Id<"chatMessages"> | null>(null);
  const runAskStreamed = async (
    sessionId: Id<"chatSessions">,
    prompt: string,
    history: { role: string; content: string }[],
    imageUrls?: string[],
    branchId?: Id<"chatBranches"> | null,
  ) => {
    const streamMsgId = await appendMessage({
      sessionId,
      branchId: branchId ?? null,
      role: "assistant",
      content: "",
    });
    streamedMessageIdRef.current = streamMsgId;
    setStreaming(true);
    try {
      return await askStreamAction({
        sessionId,
        messageId: streamMsgId,
        prompt,
        history,
        personaId: activePersonaId,
        ...(imageUrls && imageUrls.length > 0 ? { imageUrls } : {}),
        ...(live.active ? { task: "live" as const } : {}),
      });
    } catch (err) {
      // The placeholder would otherwise stay blank forever — write the error
      // into it so the transcript never shows an empty assistant turn.
      const msg = err instanceof Error ? err.message : "Something went wrong.";
      await patchMessageContent({ messageId: streamMsgId, content: msg }).catch(
        () => {},
      );
      throw err;
    } finally {
      setStreaming(false);
    }
  };

  /**
   * Stop a reply that is still being written.
   *
   * A Convex action cannot be cancelled from the browser, so this raises a flag
   * on the message row instead; the streaming loop reads it on the delta write
   * it was making anyway and stops there. The partial text is kept — the user
   * read it before changing their mind, and it is marked truncated so nothing
   * pretends it finished.
   */
  const handleStop = useCallback(async () => {
    const id = streamedMessageIdRef.current;
    if (!id || !streaming) return;
    await requestStop({ messageId: id }).catch(() => {});
  }, [streaming, requestStop]);

  // Keep the Escape handler pointed at the current stop function.
  useEffect(() => {
    streamingRef.current = streaming;
    stopRef.current = handleStop;
  });

  /**
   * Carry on from a reply that stopped short, appending to the same message.
   */
  const handleContinue = useCallback(
    async (messageId: Id<"chatMessages">, existing: string) => {
      if (continuing) return;
      setContinuing(true);
      try {
        const history = (messages ?? [])
          .slice(0, Math.max(0, (messages ?? []).findIndex((m) => m._id === messageId)))
          .map((m) => ({ role: m.role, content: m.content }));
        await continueReplyAction({ messageId, existing, history });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not continue that reply.",
        );
      } finally {
        setContinuing(false);
      }
    },
    [continuing, messages, continueReplyAction],
  );

  /**
   * Delete a message and everything after it on this branch.
   *
   * Takes the tail rather than the single message because a conversation with
   * a hole in it is worse than a shorter one: the reply that answered the
   * deleted question is still on screen answering nothing. Earlier forks are
   * separate branches and are untouched.
   */
  const handleDeleteMessage = useCallback(
    async (messageId: Id<"chatMessages">) => {
      try {
        const { deleted } = await deleteMessageAndTail({ messageId });
        toast.success(
          deleted > 1
            ? `Deleted ${deleted} messages.`
            : "Message deleted.",
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not delete that message.",
        );
      }
    },
    [deleteMessageAndTail],
  );

  /**
   * Mine the finished exchange for durable facts. Fire-and-forget: memory is
   * a bonus, and a failure here must never surface to the user.
   */
  const extractMemories = (
    userText: string,
    assistantText: string,
  ) => {
    if (!userText?.trim() || !assistantText?.trim()) return;
    void extractMemory({
      userMessage: userText,
      assistantMessage: assistantText,
    }).catch(() => {});
  };

  const runAsk = async (
    prompt: string,
    history: { role: string; content: string }[],
    imageUrls?: string[],
  ) => {
    return await askAction({
      prompt,
      history,
      imageUrls,
      personaId: activePersonaId,
      // Live voice trades a little depth for time to first word, so the router
      // is told to weight responsiveness here rather than guessing.
      ...(live.active ? { task: "live" as const } : {}),
    });
  };

  const runDeepResearch = async (
    _sessionId: Id<"chatSessions">,
    query: string,
    history: { role: string; content: string }[],
  ) => {
    return await deepResearchAction({ query, history });
  };

  const handleAnalyze = async () => {
    if (!lastMsg || panelBusy) return;
    setPanelBusy("nlp");
    setAssistantError(null);
    try {
      const result = await analyzeAction({ text: lastMsg.content });
      setPanelNlp(result as NlpResult);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "NLP analysis failed.",
      );
    } finally {
      setPanelBusy(null);
    }
  };

  const handleNews = async () => {
    if (!input.trim() || panelBusy) return;
    setPanelBusy("news");
    setAssistantError(null);
    try {
      const items = await newsAction({ keywords: input.trim() });
      setPanelNews(items as NewsItem[]);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "News search failed.",
      );
    } finally {
      setPanelBusy(null);
    }
  };

  // --- Composer mode chips (Gemini-style): News / Analyze run on next send ---
  const runNewsOnInput = async () => {
    const topic = input.trim();
    if (!topic || panelBusy) return;
    setInput("");
    setPanelBusy("news");
    setAssistantError(null);
    try {
      const items = await newsAction({ keywords: topic });
      setPanelNews(items as NewsItem[]);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "News search failed.");
    } finally {
      setPanelBusy(null);
      setModeNews(false);
    }
  };

  const runAnalyzeOnInput = async () => {
    const text = input.trim();
    if (!text || panelBusy) return;
    setInput("");
    setPanelBusy("nlp");
    setAssistantError(null);
    try {
      const result = await analyzeAction({ text });
      setPanelNlp(result as NlpResult);
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "NLP analysis failed.");
    } finally {
      setPanelBusy(null);
      setModeAnalyze(false);
    }
  };

  // The send button: dispatch to the armed mode, else the normal chat flow.
  const runModeSend = async () => {
    if (modeNews) {
      await runNewsOnInput();
      return;
    }
    if (modeAnalyze) {
      await runAnalyzeOnInput();
      return;
    }
    await runSend();
  };

  const handleSignOut = async () => {
    // Signing out drops the key and everything it had opened in memory —
    // otherwise the next person at this tab inherits a decrypted transcript.
    lockEverything();
    await signOut();
    navigate("/");
  };

  // --- Summarize URL ---
  const handleSummarizeUrl = async () => {
    const url = summarizeInput.trim();
    if (!url || summarizingUrl) return;
    setSummarizingUrl(true);
    setAssistantError(null);
    setSummarizeInput("");
    try {
      // Create a session if needed
      let sessionId = activeId;
      if (!sessionId) {
        const { sessionId: sid } = await startWithMessage({
          content: `Summarize: ${url}`,
        });
        sessionId = sid;
        setActiveId(sid);
      } else {
        await appendMessage({
          sessionId,
          role: "user",
          content: `Summarize: ${url}`,
        });
      }
      const history = (messages ?? []).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const answer = await summarizeUrlAction({ url, history });
      await appendMessage({
        sessionId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        usedFallback: answer.usedFallback,
        usedSearch: false,
      });
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Failed to summarize URL.",
      );
    } finally {
      setSummarizingUrl(false);
    }
  };

  // --- Puter connect / disconnect ---
  // Called straight from the menu item's click so Puter's sign-in popup keeps
  // the user gesture it needs; signing in once means later /image calls go
  // straight to Puter without a popup.
  const handleConnectPuter = async () => {
    setPuterConnecting(true);
    try {
      const status = await signInToPuter();
      setPuterAuth(status);
      if (status.signedIn) {
        toast.success(
          `Puter connected${status.username ? ` as ${status.username}` : ""}.`,
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to connect to Puter.",
      );
    } finally {
      setPuterConnecting(false);
    }
  };

  const handleDisconnectPuter = async () => {
    try {
      await signOutOfPuter();
      setPuterAuth({ signedIn: false, username: null });
      toast.success("Puter disconnected.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to disconnect Puter.",
      );
    }
  };

  // --- Cloudinary OAuth connect / disconnect ---
  /** Exactly the URI Cloudinary must have pre-registered for this origin. */
  const cloudinaryRedirectUri = `${window.location.origin}/cloudinary/callback`;

  // Cloudinary rejects the authorize request outright when this URI is not in
  // the OAuth app's registered list, and the user lands on Cloudinary's own
  // error page with no idea which value to paste. Hand it to them on demand.
  const handleCopyCloudinaryRedirectUri = async () => {
    if (window.location.origin === "null") {
      toast.error(
        "This page has an opaque origin, so there is no valid redirect URI to copy. Open Jarvis in its own tab.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(cloudinaryRedirectUri);
      toast.success(
        "Redirect URI copied — paste it into Cloudinary OAuth settings.",
      );
    } catch {
      toast.error(cloudinaryRedirectUri);
    }
  };

  const handleConnectCloudinary = async () => {
    // Cloudinary only accepts a redirect URI that exactly matches one registered
    // in the OAuth app. An opaque origin (sandboxed frame) stringifies to "null",
    // which would send the user to a bogus "null/cloudinary/callback" and fail
    // with an opaque Cloudinary error — say what is actually wrong instead.
    if (window.location.origin === "null") {
      toast.error(
        "This page has an opaque origin (sandboxed frame), so there is no valid Cloudinary redirect URI. Open Jarvis in its own tab and connect Cloudinary there.",
      );
      return;
    }
    setCloudinaryConnecting(true);
    try {
      const redirectUri = cloudinaryRedirectUri;
      const { url } = await getOAuthStartUrlAction({ redirectUri });
      window.location.href = url; // full-page redirect to Cloudinary consent
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start Cloudinary connection.",
      );
      setCloudinaryConnecting(false);
    }
  };

  const handleDisconnectCloudinary = async () => {
    try {
      await disconnectCloudinaryAction({});
      toast.success("Cloudinary disconnected — using API key auth.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to disconnect Cloudinary.",
      );
    }
  };

  // --- Canva OAuth connect / disconnect (authorization code + PKCE) ---
  /** Exactly the URI Canva must have pre-registered for this origin. */
  const canvaRedirectUri = `${window.location.origin}/canva/callback`;

  // Canva rejects the authorize request when the redirect URI isn't already in
  // the app's registered list, and the user lands on Canva's own error page
  // with no idea which value to paste. Hand it to them on demand.
  const handleCopyCanvaRedirectUri = async () => {
    if (window.location.origin === "null") {
      toast.error(
        "This page has an opaque origin, so there is no valid redirect URI to copy. Open Jarvis in its own tab.",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(canvaRedirectUri);
      toast.success(
        "Redirect URI copied — paste it into your Canva app's Redirect URLs.",
      );
    } catch {
      toast.error(canvaRedirectUri);
    }
  };

  const handleConnectCanva = async () => {
    // An opaque origin (sandboxed frame) stringifies to "null", which would
    // send the user to a bogus "null/canva/callback" and fail with an opaque
    // Canva error — say what is actually wrong instead.
    if (window.location.origin === "null") {
      toast.error(
        "This page has an opaque origin (sandboxed frame), so there is no valid Canva redirect URI. Open Jarvis in its own tab and connect Canva there.",
      );
      return;
    }
    setCanvaConnecting(true);
    try {
      const redirectUri = canvaRedirectUri;
      const { url } = await getCanvaOAuthStartUrl({ redirectUri });
      window.location.href = url; // full-page redirect to Canva consent
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start Canva connection.",
      );
      setCanvaConnecting(false);
    }
  };

  const handleDisconnectCanva = async () => {
    try {
      await disconnectCanvaAction({});
      toast.success("Canva disconnected.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to disconnect Canva.",
      );
    }
  };

  // ---- Dark mode toggle (persisted) ----
  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("jarvis-theme", next ? "dark" : "light");
    } catch {
      // ignore storage errors
    }
  };

  // Apply the seeded theme to <html>. State is already correct from the lazy
  // initialiser, so this only mirrors it onto the document element.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // ---- AI-generated chat titles: run once after the first exchange ----
  const titleGeneratedFor = useRef<Id<"chatSessions"> | null>(null);
  useEffect(() => {
    if (
      !activeId ||
      sending ||
      !messages ||
      messages.length < 2 ||
      titleGeneratedFor.current === activeId
    )
      return;
    const firstUser = messages.find((m) => m.role === "user");
    if (!firstUser || firstUser.content.startsWith("[Image]")) return;
    titleGeneratedFor.current = activeId;
    void generateTitleAction({ firstMessage: firstUser.content })
      .then(({ title }) => renameSessionMutation({ sessionId: activeId, title }))
      .catch(() => {
        // silent — truncation fallback already applied server-side
      });
  }, [activeId, messages, sending, generateTitleAction, renameSessionMutation]);

  // ---- PDF Q&A: extract text from a PDF and ask Jarvis about it ----
  const handlePdfQuestion = async (question: string) => {
    if (pdfBusy) return;
    // Only the first PDF is read this turn; the rest stay on the composer
    // rather than being quietly discarded.
    const file = pendingFiles.find((f) => /pdf/.test(f.type));
    if (!file) return;
    setPdfBusy(true);
    setAssistantError(null);
    const userQuestion = question || "Summarize this document";
    setPendingFiles((prev) => prev.filter((f) => f !== file));
    try {
      const { text, pages } = await extractPdfTextAction({ url: file.url });

      // Build a session if needed
      let sessionId: Id<"chatSessions">;
      let history: { role: string; content: string }[] = [];
      if (!activeId) {
        const { sessionId: sid } = await startWithMessage({
          content: `[PDF: ${file.name}] ${userQuestion}`,
          fileUrl: file.url,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
        sessionId = sid;
        setActiveId(sid);
      } else {
        sessionId = activeId;
        await appendMessage({
          sessionId,
          role: "user",
          content: `[PDF: ${file.name}] ${userQuestion}`,
          fileUrl: file.url,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });
        history = (messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }

      const answer = await askAction({
        prompt:
          `A user uploaded a PDF document (${file.name}, ${pages} pages). ` +
          `Here is its extracted text:\n\n<document>\n${text}\n</document>\n\n` +
          `The user asks: ${userQuestion}\n\n` +
          "Answer grounded ONLY in the document. If the answer isn't in the document, say so.",
        history,
      });

      await appendMessage({
        sessionId,
        role: "assistant",
        content: answer.text,
        model: answer.model,
        usedFallback: answer.usedFallback,
        usedSearch: false,
      });
      setPendingFiles([]);
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "PDF analysis failed.",
      );
    } finally {
      setPdfBusy(false);
    }
  };

  // ---- Prompt library ----
  const [promptTitle, setPromptTitle] = useState("");
  const handleSavePrompt = async () => {
    const content = input.trim();
    if (!content) return;
    try {
      await savePromptMutation({
        title: promptTitle.trim() || content.slice(0, 40),
        content,
      });
      toast.success("Prompt saved to library.");
      setPromptTitle("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save prompt.");
    }
  };

  const handleUsePrompt = (content: string) => {
    setInput(content);
    setShowPrompts(false);
    inputRef.current?.focus();
  };

  // Insert a ready-to-fill ```desmos block for the given calculator mode.
  // Scientific/geometry take no expressions; graphing/3d get a fill-in slot.
  const insertDesmosBlock = (mode: "graphing" | "3d" | "scientific" | "geometry" | "fourfunction") => {
    const block =
      mode === "scientific" || mode === "geometry" || mode === "fourfunction"
        ? "```desmos\nmode: " + mode + "\n```"
        : "```desmos\nmode: " + mode + "\nzoom: 10\nexpressions:\n\n```";
    setInput((prev) => (prev.trim() ? prev.replace(/\s*$/, "\n\n" + block) : block));
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      if (mode === "scientific" || mode === "geometry" || mode === "fourfunction") {
        el.setSelectionRange(el.value.length, el.value.length);
        return;
      }
      const pos = el.value.length - 4; // just before the closing fence
      el.setSelectionRange(pos, pos);
    });
  };

  // --- Export chat as Markdown ---
  // Export now lives in the ExportPanel (Markdown / text / HTML / JSON, with
  // copy + download) — see src/lib/export-chat.ts.

  // --- Voice output: Groq TTS → browser SpeechSynthesis fallback ---
  const browserSpeakRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speakViaBrowser = (id: string, text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setAssistantError("Speech synthesis not supported in this browser.");
      return;
    }
    synth.cancel();
    // Speak the message, never the markup (same sanitizer the server TTS uses).
    const spoken = sanitizeForSpeech(text, 4000);
    if (!spoken) {
      player.setLoadingId(null);
      return;
    }
    const utt = new SpeechSynthesisUtterance(spoken);
    // Match the voice to the selected country's language
    const tag = getCountry(countryCode).langTag;
    const langPrefix = tag.split("-")[0];
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => v.lang === tag) ??
      voices.find((v) => v.lang.startsWith(langPrefix));
    if (voice) {
      utt.voice = voice;
      utt.lang = voice.lang;
    } else {
      utt.lang = tag;
    }
    utt.rate = 1;
    utt.pitch = 1;
    utt.onend = () => {
      browserSpeakRef.current = null;
      player.setPlayingId(null);
    };
    utt.onerror = () => {
      browserSpeakRef.current = null;
      player.setPlayingId(null);
    };
    browserSpeakRef.current = utt;
    player.setPlayingId(id);
    synth.speak(utt);
  };

  const handleTranslate = async (id: string, content: string) => {
    // Tapping again on an already-translated message reveals the original.
    if (translations[id]) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    const target = getTranslateLanguage(translateTarget);
    if (!target) {
      setAssistantError("Pick a translation language first.");
      return;
    }

    setTranslatingId(id);
    setAssistantError(null);
    try {
      // Sarvam first; if the key is missing or the language is unsupported,
      // the chat model translates instead so the button still does something.
      const result = await translateAction({
        text: content,
        target: target.code,
      });

      if (result.translated) {
        setTranslations((prev) => ({
          ...prev,
          [id]: {
            text: result.translated!,
            language: result.targetName,
            engine: result.engine,
          },
        }));
        return;
      }

      const fallback = await askAction({
        prompt: `Translate the following text into ${target.name} (${target.native}). Reply with ONLY the translation, no preamble, no quotes, no explanation. Preserve any markdown structure.\n\n${content}`,
        history: [],
      });
      setTranslations((prev) => ({
        ...prev,
        [id]: {
          text: fallback.text,
          language: target.name,
          engine: fallback.model,
        },
      }));
    } catch (err) {
      setAssistantError(
        err instanceof Error ? err.message : "Translation failed.",
      );
    } finally {
      setTranslatingId(null);
    }
  };

  const handleSpeak = async (id: string, content: string) => {
    if (player.playingId === id) {
      player.stop();
      window.speechSynthesis?.cancel();
      return;
    }
    player.setLoadingId(id);
    setAssistantError(null);
    try {
      const { audio } = await speakAction({
        text: content,
        langTag: getCountry(countryCode).langTag,
        ...(voicePref.speaker ? { speaker: voicePref.speaker } : {}),
        ...(voicePref.voice ? { voice: voicePref.voice } : {}),
        ...(voicePref.pace !== 1 ? { pace: voicePref.pace } : {}),
      });
      if (audio) {
        player.play(id, audio);
      } else {
        // No server TTS available — browser voice takes over seamlessly.
        player.setLoadingId(null);
        speakViaBrowser(id, content);
      }
    } catch {
      player.setLoadingId(null);
      speakViaBrowser(id, content);
    }
  };

  // --- Region command handlers ---
  const handleRegionCommand = async (cmd: string, arg: string) => {
    setRegionBusy(true);
    setRegionResult(null);
    setAssistantError(null);
    try {
      switch (cmd) {
        case "time": {
          const result = await getWorldTimeAction({ timezone: arg || undefined });
          setRegionResult({ type: "time", ...result });
          break;
        }
        case "weather": {
          if (!arg) throw new Error("Usage: /weather <city>");
          const result = await getWeatherAction({ city: arg });
          setRegionResult({ type: "weather", ...result });
          break;
        }
        case "currency": {
          // Parse: /currency 100 USD to EUR
          const match = arg.match(/(\d+\.?\d*)\s+(\w{3})\s+to\s+(\w{3})/i);
          if (!match) throw new Error("Usage: /currency <amount> <FROM> to <TO>\nExample: /currency 100 USD to EUR");
          const [, amount, from, to] = match;
          const result = await getCurrencyRateAction({ from, to, amount: parseFloat(amount) });
          setRegionResult({ type: "currency", ...result });
          break;
        }
        case "country": {
          if (!arg) throw new Error("Usage: /country <name>");
          const result = await getCountryInfoAction({ query: arg });
          setRegionResult({ type: "country", ...result });
          break;
        }
      }
    } catch (err) {
      setAssistantError(err instanceof Error ? err.message : "Command failed.");
    } finally {
      setRegionBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the autocomplete is open, the arrow keys and Enter belong to it
    // rather than to the textarea: otherwise choosing a command with Enter
    // would also send whatever half-typed text is in the box.
    if (slashOpen) {
      const options = filterSlashCommands(slashToken);
      if (options.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashIndex((i) => (i + 1) % options.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashIndex((i) => (i - 1 + options.length) % options.length);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          const picked = options[Math.min(slashIndex, options.length - 1)];
          if (picked) {
            e.preventDefault();
            applySlashCommand(picked);
            return;
          }
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      // /solve — structured step-by-step math solution
      const solveMatch = text.match(/^\/(solve|math)\s+([\s\S]+)/i);
      if (solveMatch) {
        const [, , problem] = solveMatch;
        setInput(
          `Solve this step by step using proper LaTeX math notation. FORMAT RULES (strict): inline math as $...$; display math as $$ on its OWN line, the math on the next line, then $$ on its own line (never $$math$$ on one line); never put text, headers, or --- on the same line as $$; always close every \\begin{...} with \\end{...}; use \\boxed{...} for the final result. Show your method, every step with working, and end with brief Remarks. If the problem mentions a graph, plot, or visualizing the function (e.g. "x² in graph"), ALSO emit an interactive Desmos block so the graph renders live: a fenced code block tagged desmos with \`mode: graphing\`, an optional \`zoom: 10\`, then \`expressions:\` and the function in Desmos plain-text syntax (like \`y = x^2\`, no $ or backslashes), one per line: ${problem}`,
        );
        // Small delay so the state lands, then trigger send
        setTimeout(() => {
          const btn = document.querySelector<HTMLButtonElement>("[data-send-button]");
          btn?.click();
        }, 50);
        return;
      }
      // /image — generate directly from the message bar
      // /plot — force an interactive Desmos graph of the given expression(s)
      const plotMatch = text.match(/^\/(plot|graph)\s+([\s\S]+)/i);
      if (plotMatch) {
        const [, , expr] = plotMatch;
        const exprLines = expr
          .split(/[;,\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const is3d = exprLines.some((l) => /\bz\s*=/i.test(l));
        const block =
          "```desmos\nmode: " + (is3d ? "3d" : "graphing") + "\nzoom: 10\nexpressions:\n" +
          exprLines.join("\n") + "\n```";
        setInput("");
        void runSendWithText(block);
        return;
      }

      const imageMatch = text.match(/^\/(image|img|draw)\s+([\s\S]+)/i);
      if (imageMatch) {
        const [, , prompt] = imageMatch;
        setInput("");
        void handleGenerateImageWithText(prompt);
        return;
      }

      // Everything else in the registry.
      const match = matchSlashCommand(text);
      if (match) {
        // A command that needs an argument and was given none is a typo, not
        // an instruction to send the literal text as a message.
        if (match.command.needsArg && !match.args) {
          setInput(`/${match.command.name} `);
          inputRef.current?.focus();
          return;
        }
        setInput("");
        void runSlashCommand(match.command, match.args);
        return;
      }

      void runSend();
    }
  };

  /**
   * Fill the composer from a picked command.
   *
   * Commands that take an argument are only written into the box — the user
   * still has to say what they want. The rest run immediately, because arriving
   * at this function is not the same as having decided to.
   */
  const applySlashCommand = (command: SlashCommand) => {
    setSlashIndex(0);
    if (command.needsArg) {
      setInput(`/${command.name} `);
      inputRef.current?.focus();
      return;
    }
    setInput("");
    void runSlashCommand(command, "");
  };

  /** The single executor behind both Enter and the autocomplete. */
  const runSlashCommand = async (command: SlashCommand, args: string) => {
    switch (command.name) {
      case "time":
      case "weather":
      case "currency":
      case "country":
        await handleRegionCommand(command.name, args);
        return;
      case "news": {
        setAssistantError(null);
        setPanelNews(null);
        setPanelBusy("news");
        try {
          const items = await newsAction({ keywords: args });
          setPanelNews(items as NewsItem[]);
        } catch (err) {
          setAssistantError(
            err instanceof Error ? err.message : "Could not load the news.",
          );
        } finally {
          setPanelBusy(null);
        }
        return;
      }
      case "research":
        setDeepResearch(true);
        if (args) {
          setInput(args);
          inputRef.current?.focus();
        }
        return;
      case "listen": {
        const from = lastMsg?._id ?? messages?.[0]?._id;
        if (!from) {
          toast.error("Nothing to read yet.");
          return;
        }
        listening.start(from);
        return;
      }
      case "pinned":
        setShowPins(true);
        return;
      case "export":
        setShowExport(true);
        return;
      case "stats":
        setShowStats(true);
        return;
      case "find":
        openFind(args || undefined);
        return;
      case "studio":
        setShowStudio(true);
        return;
      case "new":
        setActiveId(null);
        return;
      default:
        // /image, /plot and /solve never reach here: the block above owns the
        // long prompts they need.
        setInput(`/${command.name} ${args}`.trimEnd());
        inputRef.current?.focus();
    }
  };

  // Titles come from your first message, so they are encrypted alongside it.
  const titleOf = useDecryptedTitles(sessions);
  const activeSessionRow = activeId
    ? sessions.find((s) => s._id === activeId)
    : undefined;
  const sessionTitle = activeSessionRow ? titleOf(activeSessionRow) : "New chat";

  // ---- Command palette contents -------------------------------------------
  // Built here rather than in the palette itself so every shortcut the app
  // already has becomes reachable by name, and nothing is listed twice.
  // Deliberately not memoised: twenty small objects per render is cheaper than
  // the dependency bookkeeping a memo over this many closures would need.
  const paletteCommands: PaletteCommand[] = [
      {
        id: "new-chat",
        label: "New chat",
        group: "Chat",
        icon: <Plus className="size-4" />,
        shortcut: "⌘K",
        run: () => setActiveId(null),
      },
      {
        id: "search",
        label: "Search conversations",
        group: "Chat",
        icon: <Search className="size-4" />,
        run: () => setShowSearch(true),
      },
      {
        id: "export",
        label: "Export this chat",
        group: "Chat",
        icon: <Download className="size-4" />,
        disabled: !messages || messages.length === 0,
        run: () => setShowExport(true),
      },
      {
        id: "stats",
        label: "Session stats — messages, tokens, engines",
        group: "Chat",
        keywords: "statistics analytics usage tokens",
        icon: <Gauge className="size-4" />,
        disabled: !messages || messages.length === 0,
        run: () => setShowStats(true),
      },
      {
        id: "branch",
        label: "Branch from my last message",
        group: "Chat",
        keywords: "fork alternate version",
        icon: <GitBranch className="size-4" />,
        disabled: !activeId || !(messages ?? []).some((m) => m.role === "user"),
        run: () => void handleForkLatest(),
      },
      {
        id: "mcp",
        label: "MCP servers",
        group: "Configure",
        keywords: "tools integrations connect",
        icon: <ExternalLink className="size-4" />,
        run: () => setShowMcp(true),
      },
      {
        id: "integrations",
        label: "Integrations — everything Jarvis can reach",
        group: "Configure",
        keywords: "apps accounts connect services directory marketplace",
        icon: <Blocks className="size-4" />,
        run: () => setShowIntegrations(true),
      },
      {
        id: "engines",
        label: "Engines — smart routing and pinned models",
        group: "Chat",
        icon: <Brain className="size-4" />,
        run: () => setShowEngines(true),
      },
      {
        id: "pinned",
        label: "Pinned messages",
        group: "Chat",
        icon: <Bookmark className="size-4" />,
        run: () => setShowPins(true),
      },
      {
        id: "find",
        label: "Find in this conversation",
        shortcut: "⌘F",
        group: "Chat",
        icon: <FileSearch className="size-4" />,
        run: () => openFind(),
      },
      {
        id: "image-studio",
        label: "Image Studio — styles, models, shapes",
        group: "Create",
        icon: <ImagePlus className="size-4" />,
        run: () => setShowStudio(true),
      },
      {
        id: "listen-thread",
        label: "Read this conversation aloud",
        group: "Chat",
        icon: <Headphones className="size-4" />,
        disabled: !messages || messages.length === 0,
        run: () => {
          const from = lastMsg?._id ?? messages?.[0]?._id;
          if (from) listening.start(from);
        },
      },
      {
        id: "compare-engines",
        label: "Compare the last answer with another engine",
        group: "Chat",
        icon: <GitCompare className="size-4" />,
        disabled: !lastMsg || lastMsg.role !== "assistant" || Boolean(lastMsg.altMessageId),
        run: () => {
          if (lastMsg && lastMsg.role === "assistant") {
            if (lastMsg.altMessageId) void openCompare(lastMsg._id);
            else void createDecisionBranch(lastMsg._id);
          }
        },
      },
      {
        id: "regenerate",
        label: "Regenerate the last reply",
        group: "Chat",
        keywords: "retry again",
        icon: <RotateCcw className="size-4" />,
        disabled: !lastMsg || lastMsg.role !== "assistant" || sending,
        run: () => {
          if (lastMsg?.role === "assistant") void handleRegenerate(lastMsg._id);
        },
      },
      {
        id: "instructions",
        label: "How Jarvis works (instructions & personas)",
        group: "Configure",
        keywords: "custom prompt system behaviour rules persona mode",
        icon: <Sparkles className="size-4" />,
        run: () => setShowPersona(true),
      },
      {
        id: "mcp",
        label: "MCP servers",
        group: "Configure",
        keywords: "tools integrations connect",
        icon: <ExternalLink className="size-4" />,
        run: () => setShowMcp(true),
      },
      {
        id: "integrations",
        label: "Integrations — everything Jarvis can reach",
        group: "Configure",
        keywords: "apps accounts connect services directory marketplace",
        icon: <Blocks className="size-4" />,
        run: () => setShowIntegrations(true),
      },
      {
        id: "tasks",
        label: "Scheduled tasks & reminders",
        group: "Configure",
        keywords: "cron schedule recurring reminder automation",
        icon: <AlarmClock className="size-4" />,
        run: () => setShowTasks(true),
      },
      {
        id: "deep-research",
        label: "Toggle Deep Research",
        group: "Configure",
        icon: <Globe className="size-4" />,
        run: () => setDeepResearch((v) => !v),
      },
      {
        id: "memory",
        label: "Memory",
        group: "Configure",
        icon: <Brain className="size-4" />,
        run: () => setShowMemory(true),
      },
      {
        id: "code",
        label: "Code runner",
        group: "Configure",
        icon: <Code2 className="size-4" />,
        run: () => setShowCode(true),
      },
      {
        id: "calculator",
        label: "Calculator",
        group: "Configure",
        icon: <Equal className="size-4" />,
        run: () => setShowCalculator((v) => !v),
      },
      {
        id: "prompts",
        label: "Prompt library",
        group: "Configure",
        icon: <Bookmark className="size-4" />,
        run: () => setShowPrompts(true),
      },
      {
        id: "live",
        label: live.active ? "Stop live voice mode" : "Start live voice mode",
        group: "Configure",
        keywords: "hands free hud wake",
        icon: <Radio className="size-4" />,
        run: () => (live.active ? live.stop() : void live.start()),
      },
      {
        id: "camera",
        label: camera.enabled ? "Turn camera vision off" : "Turn camera vision on",
        group: "Configure",
        icon: <Camera className="size-4" />,
        run: () => void camera.toggle(),
      },
      {
        id: "theme",
        label: isDark ? "Switch to light mode" : "Switch to dark mode",
        group: "Configure",
        icon: isDark ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: toggleTheme,
      },
      {
        // Listed because the ? key is the only other way in, and a phone has
        // no ? key.
        id: "shortcuts",
        label: "Keyboard shortcuts",
        group: "Configure",
        icon: <Keyboard className="size-4" />,
        run: () => setShowShortcuts(true),
      },
      ...sessions.slice(0, 8).map((session) => ({
        id: `session-${session._id}`,
        label: session.title,
        group: "Recent chats",
        keywords: session.projectId ? "project folder" : "",
        icon: <JarvisIcon className="size-4" />,
        run: () => setActiveId(session._id),
      })),
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <TooltipProvider>
      {/* dvh, not vh: on a phone the address bar shrinks the viewport, and a
          vh shell pushes the composer behind it. h-screen stays as the
          pre-dvh fallback in the same class list. */}
      <div className="flex h-dvh bg-background text-foreground">
        {/* ---- Desktop sidebar ---- */}
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center justify-between px-5 py-4">
            <Link to="/" className="flex items-center gap-2.5">
              <JarvisIcon className="size-5" />
              <span className="text-sm font-semibold tracking-tight">
                JARVIS
              </span>
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setActiveId(null)}
              title="New chat"
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <Separator />
          <ProjectSidebar
            activeId={activeId}
            onSelect={(id) => setActiveId(id)}
            onNewChat={() => setActiveId(null)}
          />
          <Separator />
          <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
            <span className="truncate">
              {user?.name || user?.email || "Guest"}
            </span>
            <button
              onClick={handleSignOut}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* ---- Mobile sidebar overlay ---- */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/40 md:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", damping: 30, stiffness: 350 }}
                className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-sidebar md:hidden"
              >
                <div className="flex items-center justify-between px-5 py-4">
                  <Link
                    to="/"
                    className="flex items-center gap-2.5"
                  >
                    <JarvisIcon className="size-5" />
                    <span className="text-sm font-semibold tracking-tight">
                      JARVIS
                    </span>
                  </Link>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <Separator />
                <div className="flex-1 overflow-hidden">
                  <ProjectSidebar
                    activeId={activeId}
                    onSelect={(id) => {
                      setActiveId(id);
                      setSidebarOpen(false);
                    }}
                    onNewChat={() => {
                      setActiveId(null);
                      setSidebarOpen(false);
                    }}
                  />
                </div>
                <Separator />
                <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
                  <span className="truncate">
                    {user?.name || user?.email || "Guest"}
                  </span>
                  <button
                    onClick={handleSignOut}
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Sign out
                  </button>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* ---- Main area ---- */}
        <main
          className="flex min-w-0 flex-1 flex-col"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* ---- Menu bar ---- */}
          <header className="flex items-center justify-between border-b px-4 py-2 sm:px-6">
            {/* Left: hamburger + title. min-w-0 is what lets the title
                actually truncate instead of pushing the buttons sideways. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
                title="Menu"
              >
                <Menu className="size-4" />
              </button>
              <div className="hidden items-center gap-2 md:flex">
                <JarvisIcon className="size-4 text-muted-foreground" />
                <Separator orientation="vertical" className="h-4" />
              </div>
              <span className="min-w-0 max-w-[38vw] truncate text-sm text-muted-foreground sm:max-w-[20rem]">
                {sessionTitle}
              </span>
              {activeId ? (
                <PersonaPicker
                  sessionId={activeId}
                  personaId={activePersonaId}
                />
              ) : null}
            </div>

            {/* Right: menu bar actions */}
            <div className="flex items-center gap-1">
              {/* New chat (desktop) */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                onClick={() => setActiveId(null)}
                title="New chat"
              >
                <Plus className="size-4" />
              </Button>

              {/* Command palette */}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Command palette (⌘K)"
                onClick={() => setShowPalette(true)}
              >
                <Search className="size-4" />
              </Button>

              {/* Image Studio — the workbench for prompts the chat's
                  one-shot /image cannot steer. */}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Image Studio"
                onClick={() => setShowStudio(true)}
              >
                <ImagePlus className="size-4" />
              </Button>

              {/* Find in this conversation — the page's own ⌘F would only
                  ever see ciphertext. */}
              <Button
                variant="ghost"
                size="icon-sm"
                title="Find in this conversation (⌘F)"
                onClick={() => openFind()}
              >
                <FileSearch className="size-4" />
              </Button>

              {/* Keyboard shortcuts, engines, pins and the WebSocket panel
                  sit below sm: nine icon buttons will not fit next to a title
                  on a phone, and every one of them is also a command-palette
                  entry — so nothing becomes unreachable by hiding them. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden sm:inline-flex"
                title="Keyboard shortcuts (?)"
                onClick={() => setShowShortcuts(true)}
              >
                <Keyboard className="size-4" />
              </Button>

              {/* Which model answers each turn, and why. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden sm:inline-flex"
                title="Engines — smart routing and pinned models"
                onClick={() => setShowEngines(true)}
              >
                <Brain className="size-4" />
              </Button>

              {/* Pinned messages from every chat. */}
              <div className="relative hidden sm:block">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Pinned messages"
                  onClick={() => setShowPins((v) => !v)}
                >
                  <Bookmark className="size-4" />
                </Button>
              </div>

              {/* The local WebSocket live pipeline, which is a different thing
                  from the in-app live mode and is not otherwise reachable. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden sm:inline-flex"
                title="Local live session (WebSocket pipeline)"
                onClick={() => setShowLivePanel(true)}
              >
                <Waves className="size-4" />
              </Button>

              {/* Tools menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Tools"
                  >
                    <Settings className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Tools</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeepResearch((v) => !v)}
                  >
                    <Globe className="size-4" />
                    Deep Research
                    {deepResearch ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setVoiceOutput((v) => !v)}
                  >
                    {voiceOutput ? (
                      <Volume2 className="size-4" />
                    ) : (
                      <VolumeX className="size-4" />
                    )}
                    Voice output
                    {voiceOutput ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setStreamReplies((v) => !v)}
                  >
                    <Zap className="size-4" />
                    Streaming replies
                    {streamReplies ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void camera.toggle()}
                  >
                    {camera.enabled ? (
                      <Camera className="size-4" />
                    ) : (
                      <CameraOff className="size-4" />
                    )}
                    {camera.enabled ? "Camera on" : "Camera vision"}
                    {camera.enabled ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowMemory((v) => !v)}
                  >
                    <Brain className="size-4" />
                    Memory
                    {showMemory ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowAeroOverview(true)}
                  >
                    <Gauge className="size-4" />
                    AeroTransformGen
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowAeroTransform(true)}
                  >
                    <Bot className="size-4" />
                    AeroTransformGen Dev
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowCode((v) => !v)}
                  >
                    <Code2 className="size-4" />
                    Code runner
                    {showCode ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowPlugins(true)}>
                    <Puzzle className="size-4" />
                    Plugins
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowMcp(true)}>
                    <ExternalLink className="size-4" />
                    MCP servers
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowIntegrations(true)}>
                    <Blocks className="size-4" />
                    Integrations
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowSearch((v) => !v)}>
                    <Search className="size-4" />
                    Search conversations
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setSummarizeInput("https://"); }}>
                    <Link2 className="size-4" />
                    Summarize URL
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setShowExport((v) => !v)}
                    disabled={!messages || messages.length === 0}
                  >
                    <Download className="size-4" />
                    Export chat
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void handleRegionCommand("time", regionTimezone)}>
                    🕐 Current time
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/weather "); inputRef.current?.focus(); }}>
                    🌤 Weather lookup
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/currency 100 "); inputRef.current?.focus(); }}>
                    💱 Currency convert
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { setInput("/country "); inputRef.current?.focus(); }}>
                    🌍 Country info
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setShowCalculator((v) => !v); setRegionResult(null); }}>
                    🧮 Calculator (ML & Math)
                    {showCalculator ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => { setShowPrompts((v) => !v); setShowSearch(false); }}>
                    <Bookmark className="size-4" />
                    Prompt library
                    {showPrompts ? (
                      <Check className="ml-auto size-4" />
                    ) : null}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={toggleTheme}>
                    {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    {isDark ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Shapes className="size-4" />
                      Palette
                      <span className="ml-auto mr-1 text-[10px] opacity-60">
                        {PALETTES.find((p) => p.id === palette)?.name}
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-60">
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Console skin
                      </DropdownMenuLabel>
                      {PALETTES.map((option) => (
                        <DropdownMenuItem
                          key={option.id}
                          onClick={() => setPalette(option.id)}
                        >
                          <span
                            aria-hidden
                            className="size-4 shrink-0 rounded-full border border-border"
                            style={{
                              background: `linear-gradient(135deg, ${option.swatch[0]} 0 50%, ${option.swatch[1]} 50% 100%)`,
                            }}
                          />
                          <span className="flex flex-col">
                            <span>{option.name}</span>
                            <span className="text-[10px] leading-3 text-muted-foreground">
                              {option.tagline}
                            </span>
                          </span>
                          {palette === option.id ? (
                            <Check className="ml-auto size-4 text-primary" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowPersona(true)}>
                    <Sparkles className="size-4" />
                    How Jarvis works
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowTasks(true)}>
                    <AlarmClock className="size-4" />
                    Scheduled tasks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowPalette(true)}>
                    <Search className="size-4" />
                    Command palette
                    <span className="ml-auto text-[10px] opacity-60">⌘K</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleConnectCloudinary} disabled={cloudinaryConnecting || cloudinaryStatus?.connected}>
                    <Link2 className="size-4" />
                    {cloudinaryStatus?.connected
                      ? "Cloudinary connected ✓"
                      : cloudinaryConnecting
                        ? "Connecting to Cloudinary…"
                        : "Connect Cloudinary (OAuth)"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyCloudinaryRedirectUri}>
                    <Copy className="size-4" />
                    Copy Cloudinary redirect URI
                  </DropdownMenuItem>
                  {cloudinaryStatus?.connected ? (
                    <DropdownMenuItem onClick={handleDisconnectCloudinary}>
                      <X className="size-4" />
                      Disconnect Cloudinary
                    </DropdownMenuItem>
                  ) : null}
                  {/* Canva is an image provider, not a storage target, and it
                      has no client-credentials grant — every user must
                      authorize with their own Canva account before it can be
                      used for generation. */}
                  <DropdownMenuItem onClick={handleConnectCanva} disabled={canvaConnecting || canvaStatus?.connected}>
                    <Link2 className="size-4" />
                    {canvaStatus?.connected
                      ? "Canva connected ✓"
                      : canvaConnecting
                        ? "Connecting to Canva…"
                        : "Connect Canva (image gen)"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyCanvaRedirectUri}>
                    <Copy className="size-4" />
                    Copy Canva redirect URI
                  </DropdownMenuItem>
                  {canvaStatus?.connected ? (
                    <DropdownMenuItem onClick={handleDisconnectCanva}>
                      <X className="size-4" />
                      Disconnect Canva
                    </DropdownMenuItem>
                  ) : null}
                  {/* Sign-in deliberately lives outside this menu: a Radix
                      menu item has its pointer activation stripped, which
                      costs Puter's sign-in popup the user gesture it needs.
                      Disconnecting is a plain token call, so it can stay. */}
                  {puterAuth.signedIn ? (
                    <DropdownMenuItem onClick={handleDisconnectPuter}>
                      <X className="size-4" />
                      Disconnect Puter
                      {puterAuth.username ? ` (${puterAuth.username})` : ""}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleAnalyze} disabled={!lastMsg}>
                    <Languages className="size-4" />
                    Analyze last message
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleNews}
                    disabled={!input.trim()}
                  >
                    <Newspaper className="size-4" />
                    Search news
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                    {user?.name?.[0]?.toUpperCase() ||
                      user?.email?.[0]?.toUpperCase() ||
                      "G"}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {user?.name || "Guest"}
                      </span>
                      {user?.email ? (
                        <span className="text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      ) : null}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/">
                      <Home className="size-4" /> Home
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSignOut}>
                    <User className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {/* ---- Region bar ---- */}
          <div className="flex items-center justify-between border-b border-primary/15 bg-accent/20 px-4 py-1.5 text-[11px] text-muted-foreground sm:px-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                🌐
                <select
                  value={countryCode}
                  onChange={(e) => changeCountry(e.target.value)}
                  className="cursor-pointer appearance-none bg-transparent font-medium text-foreground outline-none"
                  title="Select country — Jarvis adapts language & region"
                >
                  {COUNTRIES.map((cn) => (
                    <option key={cn.code} value={cn.code}>
                      {cn.flag} {cn.name} — {cn.languageName}
                    </option>
                  ))}
                </select>
              </span>
              {regionTime && (
                <span className="tabular-nums font-mono text-foreground">{regionTime}</span>
              )}
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <span className="cursor-default" title="/time, /weather, /currency, /country, /solve <problem>, /image <prompt>">
                Commands: <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/plot</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/solve</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/time</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/weather</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/currency</code>{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/country</code>
                <span className="ml-1 text-muted-foreground/60">|</span>
                <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">Ctrl+K</kbd> Calculator
              </span>
            </div>
          </div>

          {/* ---- Find in this conversation ---- */}
          {findOpen && (
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2 sm:px-6">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                ref={findInputRef}
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  setFindIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    stepFind(e.shiftKey ? -1 : 1);
                  }
                }}
                placeholder="Find in this conversation…"
                aria-label="Find in this conversation"
                className="h-8 min-w-0 w-full flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:max-w-xs"
              />
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                {findCount === 0
                  ? findQuery.trim()
                    ? "No matches"
                    : ""
                  : `${(findIdx % findCount) + 1} / ${findCount}`}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Previous match (Shift+Enter)"
                  onClick={() => stepFind(-1)}
                  disabled={findCount === 0}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Next match (Enter)"
                  onClick={() => stepFind(1)}
                  disabled={findCount === 0}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Close find (Esc)"
                  onClick={closeFind}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ---- Messages ---- */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            {!messages || messages.length === 0 ? (
              <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-8 sm:px-6">
                <div className="hud-panel hud-corners relative flex size-20 items-center justify-center rounded-full">
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-full blur-xl"
                    style={{
                      background:
                        "radial-gradient(circle, color-mix(in oklab, var(--signal-cyan) 35%, transparent), transparent 70%)",
                    }}
                  />
                  <JarvisOrb size={72} />
                </div>
                <p className="hud-label hud-label-cyan mt-7">Core online</p>
                <h1 className="mt-3 text-2xl font-semibold tracking-tight">
                  <span className="hud-glow-text">How can I help?</span>
                </h1>
                <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted-foreground">
                  Ask anything — try “solve x² in graph” for a live plot, or /solve
                  for step-by-step math. Turn on Deep Research for cited web
                  answers. Every turn is routed to the best engine for the task,
                  and another one takes over automatically if it fails.
                </p>
                <div className="mt-8 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    "Explain quantum computing simply",
                    "What's new in AI this week?",
                    "Summarize the history of the internet",
                    "Compare React vs Vue in 2026",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setInput(s);
                        inputRef.current?.focus();
                      }}
                      className="hud-panel rounded-lg px-4 py-3 text-left text-xs leading-5 text-muted-foreground transition-all hover:-translate-y-0.5 hover:text-foreground"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {/* Region quick actions */}
                <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "🕐 Time", cmd: "/time Asia/Tokyo" },
                    { label: "🌤 Weather", cmd: "/weather London" },
                    { label: "💱 Currency", cmd: "/currency 100 USD to EUR" },
                    { label: "🌍 Country", cmd: "/country Japan" },
                    { label: "🧮 Solve math", cmd: "/solve " },
                    { label: "🎨 Generate image", cmd: "/image " },
                    { label: "📈 Plot graph", cmd: "/plot y = x^2" },
                    { label: "🔬 Deep research", cmd: "__research__" },
                    { label: "🎙 Live voice", cmd: "__live__" },

                  ].map((item) => (
                    <button
                      key={item.cmd}
                      onClick={() => {
                        if (item.cmd === "__research__") {
                          setDeepResearch(true);
                          inputRef.current?.focus();
                          return;
                        }
                        if (item.cmd === "__live__") {
                          void live.start();
                          return;
                        }
                        setInput(item.cmd);
                        inputRef.current?.focus();
                      }}
                      className="rounded-lg border px-3 py-2.5 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-foreground"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground/60">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="size-3" /> Web search
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Mic className="size-3" /> Voice
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Languages className="size-3" /> NLP
                  </span>
                  <span className="inline-flex items-center gap-1">
                    🌐 Region
                  </span>
                  <span className="inline-flex items-center gap-1">
                    🧮 ML & Math
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Zap className="size-3" /> Auto-fallback
                  </span>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
                {activeId ? (
                  <BranchBar
                    sessionId={activeId}
                    activeBranchId={activeBranchId}
                    onSelect={(branchId) => setActiveBranchId(branchId)}
                    onNewBranch={() => void handleForkLatest()}
                  />
                ) : null}
                <ul className="space-y-8">
                  {messages.map((m) => (
                    <li
                      key={m._id}
                      data-message-id={m._id}
                      className={cn(
                        "group rounded-lg px-3 py-2 transition-colors",
                        highlight === m._id && "bg-amber-400/10 ring-1 ring-amber-400/40",
                        listening.currentId === m._id && "bg-primary/5 ring-1 ring-primary/25",
                      )}
                    >
                      {/* Label row */}
                      <div className="flex items-center gap-2.5">
                        {m.role === "assistant" ? (
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/30">
                            <JarvisIcon className="size-3.5" />
                          </div>
                        ) : (
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                            {user?.name?.[0]?.toUpperCase() ||
                              user?.email?.[0]?.toUpperCase() ||
                              "Y"}
                          </div>
                        )}
                        <span
                          className="hud-label"
                          style={
                            m.role === "assistant"
                              ? { color: "var(--signal-cyan)" }
                              : undefined
                          }
                        >
                          {m.role === "user" ? "You" : "Jarvis"}
                        </span>
                        {/* Only when the reply genuinely stopped short, so the
                            marker means something when it appears. */}
                        {m.role === "assistant" && m.truncated && (
                          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-500/90">
                            stopped early
                          </span>
                        )}
                        <button
                          onClick={() => {
                            if (!navigator.clipboard) return;
                            navigator.clipboard.writeText(m.content).then(() => {
                              setCopiedId(m._id);
                              setTimeout(() => setCopiedId(null), 1500);
                            }).catch(() => {});
                          }}
                          title="Copy message"
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {copiedId === m._id ? (
                            <Check className="size-3" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                        {m.role === "assistant" && activeId ? (
                          <button
                            onClick={() =>
                              void giveFeedback({
                                messageId: m._id,
                                value: m.feedback === "up" ? null : "up",
                              })
                            }
                            title={
                              m.feedback === "up"
                                ? "Rated good — click to clear"
                                : "This reply was good"
                            }
                            className={`rounded p-0.5 transition-colors ${
                              m.feedback === "up"
                                ? "text-emerald-500 hover:text-emerald-400"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <ThumbsUp className="size-3" />
                          </button>
                        ) : null}
                        {m.role === "assistant" && activeId ? (
                          <button
                            onClick={() =>
                              void giveFeedback({
                                messageId: m._id,
                                value: m.feedback === "down" ? null : "down",
                              })
                            }
                            title={
                              m.feedback === "down"
                                ? "Rated bad — click to clear"
                                : "This reply was bad"
                            }
                            className={`rounded p-0.5 transition-colors ${
                              m.feedback === "down"
                                ? "text-destructive hover:text-destructive/80"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            <ThumbsDown className="size-3" />
                          </button>
                        ) : null}
                        {m.role === "user" && !sending && (
                          <button
                            onClick={() => void handleEditMessage(m._id, m.content)}
                            title="Edit this message"
                            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                        {m.role === "assistant" && m._id === lastMsg?._id && !sending && (
                          <button
                            onClick={() => void handleRegenerate(m._id)}
                            title="Regenerate this reply — the original is kept"
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <RotateCcw className="size-3" />
                          </button>
                        )}
                        {m.role === "assistant" &&
                          m._id === lastMsg?._id &&
                          !sending &&
                          (m.truncated || m.content.length > 0) && (
                            <button
                              onClick={() => void handleContinue(m._id, m.content)}
                              disabled={continuing}
                              title={
                                m.truncated
                                  ? "This reply stopped early — continue from where it left off"
                                  : "Add more to this reply"
                              }
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                            >
                              <CornerDownRight className="size-3" />
                            </button>
                          )}
                        {m.role === "user" && activeId ? (
                          <BranchMenu sessionId={activeId} messageId={m._id} />
                        ) : null}
                        <button
                          onClick={() =>
                            listening.active && listening.currentId === m._id
                              ? listening.stop()
                              : listening.start(m._id)
                          }
                          title={
                            listening.active && listening.currentId === m._id
                              ? "Stop reading"
                              : "Read the conversation aloud from here"
                          }
                          className={`rounded p-0.5 transition-colors hover:text-foreground ${
                            listening.currentId === m._id
                              ? "text-primary"
                              : "text-muted-foreground"
                          }`}
                        >
                          {listening.active && listening.currentId === m._id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Headphones className="size-3" />
                          )}
                        </button>
                        <button
                          onClick={() => void togglePin(m._id, !m.pinned)}
                          title={
                            m.pinned ? "Unpin this message" : "Pin this message"
                          }
                          className={`rounded p-0.5 transition-colors hover:text-foreground ${
                            m.pinned ? "text-amber-500" : "text-muted-foreground"
                          }`}
                        >
                          <Pin className="size-3" />
                        </button>
                        {m.role === "assistant" &&
                          m._id === lastMsg?._id &&
                          !sending && (
                            <button
                              onClick={() =>
                                m.altMessageId
                                  ? void openCompare(m._id)
                                  : void createDecisionBranch(m._id)
                              }
                              disabled={comparingId === m._id}
                              title={
                                m.altMessageId
                                  ? "Compare this answer with the one from the other engine"
                                  : "Ask the best different engine the same question"
                              }
                              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                            >
                              {comparingId === m._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <GitCompare className="size-3" />
                              )}
                            </button>
                          )}
                        {m.role === "assistant" && m.altMessageId && (
                          <span className="hud-label rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
                            2 engines
                          </span>
                        )}
                        {m.role === "assistant" && (
                          <span className="relative">
                            <button
                              onMouseEnter={() => setInspecting(m._id)}
                              onMouseLeave={() => setInspecting(null)}
                              onClick={() =>
                                setInspecting(inspecting === m._id ? null : m._id)
                              }
                              title="Which engine answered this, and what it cost"
                              className="hud-readout rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-primary"
                            >
                              {m.engineId ?? m.model ?? "—"}
                            </button>
                            {inspecting === m._id ? (
                              <AnswerInspector
                                model={m.model}
                                engineId={m.engineId}
                                decisionReason={m.decisionReason}
                                latencyMs={m.latencyMs}
                                promptTokens={m.promptTokens}
                                completionTokens={m.completionTokens}
                                usedFallback={m.usedFallback}
                                truncated={m.truncated}
                                {...(m.altMessageId
                                  ? {
                                      onCompare: () => {
                                        setInspecting(null);
                                        void openCompare(m._id);
                                      },
                                      compareLabel: "Compare both answers",
                                    }
                                  : {})}
                              />
                            ) : null}
                          </span>
                        )}
                        <button
                          onClick={() => setConfirmDelete(m._id)}
                          title="Delete this message and everything after it"
                          className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Trash2 className="size-3" />
                        </button>
                        {m.role === "assistant" && (
                          <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
                            {m.usedSearch || m.usedFallback ? (
                              <span className="flex items-center gap-1">
                                {m.usedSearch && (
                                  <Globe className="size-3" />
                                )}
                                {m.usedFallback && (
                                  <RotateCcw className="size-3" />
                                )}
                                {m.usedSearch ? "web" : "fallback"}
                              </span>
                            ) : null}
                            <button
                              onClick={() => void handleTranslate(m._id, m.content)}
                              title={`Translate to ${getTranslateLanguage(translateTarget)?.name ?? "…"}`}
                              className="rounded p-0.5 transition-colors hover:text-foreground"
                            >
                              {translatingId === m._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Languages className="size-3" />
                              )}
                            </button>
                            <button
                              onClick={() =>
                                void handleSpeak(m._id, m.content)
                              }
                              title={
                                player.playingId === m._id
                                  ? "Stop playback"
                                  : "Speak"
                              }
                              className="rounded p-0.5 transition-colors hover:text-foreground"
                            >
                              {player.loadingId === m._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : player.playingId === m._id ? (
                                <VolumeX className="size-3" />
                              ) : (
                                <Volume2 className="size-3" />
                              )}
                            </button>
                          </span>
                        )}
                      </div>
                      {/* Message body */}
                      {m.role === "user" ? (
                        <div className="mt-2 ml-8.5">
                          {(() => {
                            const imgs =
                              m.images && m.images.length > 0
                                ? m.images.map((i) => i.url)
                                : m.imageUrl
                                  ? [m.imageUrl]
                                  : [];
                            if (imgs.length === 0) return null;
                            return (
                              <div
                                className={`mb-2 grid max-w-md gap-1.5 ${
                                  imgs.length === 1
                                    ? "grid-cols-1"
                                    : imgs.length === 2
                                      ? "grid-cols-2"
                                      : "grid-cols-3"
                                }`}
                              >
                                {imgs.map((url, i) => (
                                  <button
                                    key={url + i}
                                    onClick={() =>
                                      setLightbox({ images: imgs, index: i })
                                    }
                                    className="block cursor-zoom-in overflow-hidden rounded-lg border"
                                    title="View full size"
                                  >
                                    <img
                                      src={url}
                                      alt={`Image ${i + 1}`}
                                      className={`w-full object-cover transition-opacity hover:opacity-90 ${
                                        imgs.length === 1
                                          ? "max-h-64"
                                          : "h-28"
                                      }`}
                                    />
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                          {(m.attachments ?? []).length > 0 ? (
                            <div className="mb-2 space-y-1.5">
                              {(m.attachments ?? []).map((att) => (
                                <a
                                  key={att.url}
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex max-w-xs items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent"
                                >
                                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate font-medium">
                                    {att.name}
                                  </span>
                                  {att.size ? (
                                    <span className="shrink-0 text-muted-foreground">
                                      {(att.size / 1024).toFixed(0)} KB
                                    </span>
                                  ) : null}
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {m.fileUrl ? (
                            <a
                              href={m.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mb-2 flex max-w-xs items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs transition-colors hover:bg-accent"
                            >
                              <FileText className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {m.fileName ?? "Attachment"}
                              </span>
                              {m.fileSize ? (
                                <span className="shrink-0 text-muted-foreground">
                                  {(m.fileSize / 1024).toFixed(0)} KB
                                </span>
                              ) : null}
                            </a>
                          ) : null}
                          {m.content &&
                          m.content !== "[Image]" &&
                          !m.content.startsWith("[File:") ? (
                            looksLikeMathOrMarkdown(m.content) ? (
                              <div className="md-body text-sm leading-7 text-foreground">
                                <MarkdownMessage content={m.content} />
                              </div>
                            ) : (
                              <div className="text-sm leading-7 whitespace-pre-wrap text-foreground">
                                {m.content}
                              </div>
                            )
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 ml-8.5 text-sm text-foreground/90">
                          {/* Generated images live on assistant messages —
                              render them above the reply text. */}
                          {(() => {
                            const genUrl = m.imageUrl;
                            if (!genUrl) return null;
                            return (
                              <GeneratedImage
                                url={genUrl}
                                onOpen={() =>
                                  setLightbox({ images: [genUrl], index: 0 })
                                }
                              />
                            );
                          })()}
                          {/* Real images found on the web, credited to the
                              page they came from. Each tile is a link, so the
                              credit is one click away rather than a footnote
                              nobody reads. */}
                          {(m.webImages ?? []).length > 0 ? (
                            <div className="mb-3">
                              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                                <Globe className="size-3" />
                                From the web
                              </p>
                              <div className="grid max-w-md grid-cols-3 gap-1.5">
                                {(m.webImages ?? []).map((w) => (
                                  <a
                                    key={w.url}
                                    href={w.pageUrl || w.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="group block overflow-hidden rounded-lg border transition-colors hover:border-primary"
                                    title={
                                      w.source
                                        ? `Open on ${w.source}`
                                        : "Open the source page"
                                    }
                                  >
                                    <img
                                      src={w.url}
                                      alt={w.title ?? "Image from the web"}
                                      loading="lazy"
                                      className="h-24 w-full object-cover transition-opacity group-hover:opacity-90"
                                    />
                                    {w.source ? (
                                      <span className="block truncate px-1.5 py-0.5 text-[10px] text-muted-foreground group-hover:text-foreground">
                                        {w.source}
                                      </span>
                                    ) : null}
                                  </a>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <MarkdownMessage
                            content={m.content}
                            sources={m.sources}
                          />
                          {/* Blinking caret on the row currently being
                              written, so an in-flight reply reads as live
                              rather than as a finished short answer. */}
                          {streaming && m._id === lastMsg?._id ? (
                            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-foreground/70 align-text-bottom" />
                          ) : null}
                          {translations[m._id] && (
                            <div className="mt-3 rounded-lg border border-dashed bg-muted/30 px-3.5 py-2.5">
                              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                                <Languages className="size-3" />
                                {translations[m._id].language}
                                <span className="ml-auto normal-case tracking-normal opacity-70">
                                  {translations[m._id].engine}
                                </span>
                              </div>
                              <div className="text-sm leading-7 text-foreground/90">
                                <MarkdownMessage content={translations[m._id].text} />
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {m.role === "assistant" &&
                      m.sources &&
                      m.sources.length > 0 ? (
                        <div className="ml-8.5">
                          {m._id === lastMsg?._id && researchRounds > 1 ? (
                            <p className="mb-2 text-[10px] leading-4 text-muted-foreground/80">
                              Searched twice — the first round came back thin, so
                              Jarvis searched again for{" "}
                              <span className="font-mono">
                                {researchFollowUp ?? "a missing angle"}
                              </span>
                              .
                            </p>
                          ) : null}
                          <SourceList sources={m.sources} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                  {/* While streaming, the reply is already on screen growing
                      token by token — a second "thinking" row underneath it
                      would just be noise. */}
                  {sending && !streaming && (
                    <li className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
                        <JarvisOrb size={18} />
                      </span>
                      {deepResearch
                        ? "Searching the web, then thinking…"
                        : "Thinking…"}
                    </li>
                  )}
                  {streaming && (
                    <li className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
                      <span className="ml-9 inline-flex items-center gap-1.5">
                        <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" />
                        streaming
                      </span>
                    </li>
                  )}
                  {!sending && followUps.length > 0 && (
                    <li className="ml-9 mt-1 flex flex-wrap gap-1.5">
                      {followUps.map((f) => (
                        <button
                          key={f}
                          onClick={() => {
                            setFollowUps([]);
                            void runSendWithText(f);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
                        >
                          <Lightbulb className="size-3" />
                          {f}
                        </button>
                      ))}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Jump-to-latest pill when the user scrolled up during a stream */}
          <div className="relative z-10 h-0">
            {!atBottom && messages && messages.length > 0 && (
              <button
                onClick={() => {
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
                  setAtBottom(true);
                }}
                className="absolute -top-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowDown className="size-3" />
                Jump to latest
              </button>
            )}
          </div>

          {/* ---- Search panel ---- */}
          <AnimatePresence>
            {showSearch && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t border-primary/15 bg-accent/20 px-4 py-4 sm:px-6"
              >
                <div className="mx-auto max-w-2xl">
                  {/* Search console. The field is the hero: a lit cyan
                      gradient border, a soft outer bloom, and a live pulse on
                      the icon while the panel is open. */}
                  <div className="hud-panel hud-corners overflow-hidden rounded-xl">
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="relative flex size-4 items-center justify-center">
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-full bg-primary/40 blur-md"
                        />
                        <Search className="relative size-4 text-primary" />
                      </span>
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search every message across all chats…"
                        className="hud-focus w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
                        autoFocus
                      />
                      <span className="hud-label hidden shrink-0 sm:inline">
                        Esc to close
                      </span>
                      <button
                        onClick={() => { setShowSearch(false); setSearchQuery(""); }}
                        className="hud-focus shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    {/* Signal gradient along the bottom edge of the field. */}
                    <div
                      aria-hidden
                      className="h-px w-full"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), transparent)",
                      }}
                    />

                    {searchSessionsQuery && !Array.isArray(searchSessionsQuery) && (
                      <div className="max-h-52 space-y-3 overflow-y-auto px-2 py-3">
                        {searchSessionsQuery.sessions.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 px-2">
                              <span className="hud-dot" data-tone="cyan" data-static="true" />
                              <p className="hud-label">Sessions · {searchSessionsQuery.sessions.length}</p>
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {searchSessionsQuery.sessions.map((s) => (
                                <li key={s.id}>
                                  <button
                                    onClick={() => { setActiveId(s.id); setShowSearch(false); setSearchQuery(""); }}
                                    className="w-full truncate rounded-md border-l-2 border-transparent px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary hover:bg-accent/60"
                                  >
                                    {s.title}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {searchSessionsQuery.messages.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 px-2">
                              <span className="hud-dot" data-tone="blue" data-static="true" />
                              <p className="hud-label">Messages · {searchSessionsQuery.messages.length}</p>
                            </div>
                            <ul className="mt-1.5 space-y-0.5">
                              {searchSessionsQuery.messages.map((m, i) => (
                                <li key={i}>
                                  <button
                                    onClick={() => { setActiveId(m.sessionId); setShowSearch(false); setSearchQuery(""); }}
                                    className="hud-readout w-full rounded-md border-l-2 border-transparent px-3 py-2 text-left text-xs transition-colors hover:border-primary hover:bg-accent/60"
                                  >
                                    <span
                                      className="mr-1.5 text-[10px] uppercase tracking-widest"
                                      style={{
                                        color:
                                          m.role === "user"
                                            ? "var(--signal-amber)"
                                            : "var(--signal-cyan)",
                                      }}
                                    >
                                      {m.role === "user" ? "you" : "jarvis"}
                                    </span>
                                    <span className="text-foreground/90">{m.content}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {searchSessionsQuery.sessions.length === 0 && searchSessionsQuery.messages.length === 0 && (
                          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                            No results found.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Prompt library panel ---- */}
          <AnimatePresence>
            {showPrompts && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-4 py-3 sm:px-6"
              >
                <div className="mx-auto max-w-2xl">
                  <div className="mb-2 flex items-center gap-2">
                    <Bookmark className="size-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Prompt library</span>
                    <button onClick={() => setShowPrompts(false)} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </div>
                  <div className="mb-2 flex gap-2">
                    <input
                      value={promptTitle}
                      onChange={(e) => setPromptTitle(e.target.value)}
                      placeholder="Prompt title (optional)"
                      className="w-44 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
                    />
                    <button
                      onClick={() => void handleSavePrompt()}
                      disabled={!input.trim()}
                      className="rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
                    >
                      Save current input
                    </button>
                  </div>
                  <div className="max-h-48 space-y-1.5 overflow-y-auto">
                    {promptsList && promptsList.length > 0 ? (
                      promptsList.map((p) => (
                        <div key={p._id} className="group flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
                          <button
                            onClick={() => handleUsePrompt(p.content)}
                            className="min-w-0 flex-1 text-left text-xs transition-colors hover:text-foreground"
                          >
                            <span className="block truncate font-medium">{p.title}</span>
                            <span className="block truncate text-muted-foreground">{p.content}</span>
                          </button>
                          <button
                            onClick={() => void deletePromptMutation({ promptId: p._id })}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            aria-label="Delete prompt"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">No saved prompts yet. Type a prompt, then save it.</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Region result panel ---- */}
          <AnimatePresence>
            {(regionResult || regionBusy) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-4 py-3 sm:px-6"
              >
                <div className="mx-auto max-w-2xl">
                  {regionBusy && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Loading region data…
                    </div>
                  )}
                  {regionResult && !regionBusy && (
                    <RegionResultCard result={regionResult} onClose={() => setRegionResult(null)} />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Calculator panel ---- */}
          <AnimatePresence>
            {showCalculator && (
              <CalculatorPanel onClose={() => setShowCalculator(false)} />
            )}
          </AnimatePresence>            {/* ---- Memory panel ---- */}
            <AnimatePresence>
              {showMemory && <MemoryPanel onClose={() => setShowMemory(false)} />}
            </AnimatePresence>

            {/* ---- AeroTransformGen overview: runs + workspace ---- */}
            <AnimatePresence>
              {showAeroOverview ? (
                <AeroTransformGenDashboard
                  open={showAeroOverview}
                  onClose={() => setShowAeroOverview(false)}
                  onOpenRun={(id) => {
                    setAeroHandoffRunId(id);
                    setShowAeroTransform(true);
                  }}
                />
              ) : null}
            </AnimatePresence>

            {/* ---- AeroTransformGen Dev: the agentic surface ---- */}
            <AnimatePresence>
              {showAeroTransform ? (
                <AeroTransformGenPanel
                  open={showAeroTransform}
                  initialRunId={aeroHandoffRunId}
                  onClose={() => setShowAeroTransform(false)}
                />
              ) : null}
            </AnimatePresence>

            {/* ---- Code runner panel ---- */}
            <AnimatePresence>
              {showCode && (
                <CodePanel
                  onClose={() => {
                    setShowCode(false);
                    clearSkill();
                  }}
                  onSendToJarvis={(text) => {
                    setShowCode(false);
                    void runSendWithText(text);
                  }}
                  onOpenSkillPicker={() => setShowPlugins(true)}
                  skill={selectedSkill}
                  setSkill={setSelectedSkill}
                  skillCopied={skillCopied}
                  setSkillCopied={setSkillCopied}
                />
              )}
            </AnimatePresence>

            {showCode && loadingSkill && (
              <div className="flex items-center gap-2 border-t px-4 py-3 text-[11px] text-muted-foreground sm:px-6">
                <Loader2 className="size-3.5 animate-spin" />
                <BookOpen className="size-3.5" />
                <span>
                  Loading skill{" "}
                  <span className="font-medium">{loadingSkill.skillName}</span>
                  …
                </span>
              </div>
            )}

            {/* ---- Export panel ---- */}
            <AnimatePresence>
              {showExport && messages && messages.length > 0 && (
                <ExportPanel
                  session={{
                    title:
                      sessions?.find((s) => s._id === activeId)?.title ??
                      "Jarvis chat",
                    messages: messages.map((m) => ({
                      role: m.role,
                      content: m.content,
                      model: m.model,
                      createdAt: m.createdAt,
                      imageUrl: m.imageUrl,
                    images: m.images,
                    fileUrl: m.fileUrl,
                    fileName: m.fileName,
                    sources: m.sources,
                  })),
                }}
                messageCount={messages.length}
                onClose={() => setShowExport(false)}
              />
            )}
          </AnimatePresence>

          {/* ---- Image Studio ---- */}
          <ImageStudio
            open={showStudio}
            onOpenChange={setShowStudio}
            generate={async ({ prompt: p, model: m, aspectRatio }) =>
              await generateImageAction({ prompt: p, model: m, aspectRatio })
            }
            onUseInChat={studioUseInChat}
          />

          {/* ---- Session stats ---- */}
          <SessionStatsDialog
            open={showStats}
            onOpenChange={setShowStats}
            title={sessionTitle}
            messages={messages ?? []}
          />

          {/* ---- Panel (NLP / news / voice / errors) ---- */}
          <AnimatePresence>
            {(panelNlp || panelNews || panelVoice || assistantError) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="border-t px-4 py-3 sm:px-6"
              >
                <div className="mx-auto max-w-2xl">
                  {assistantError && (
                    <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
                      <span className="mt-px">⚠</span>
                      <span className="whitespace-pre-line font-mono">
                        {assistantError}
                      </span>
                    </p>
                  )}
                  {panelNlp && (
                    <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {formatNlp(panelNlp)}
                    </pre>
                  )}
                  {panelNews && panelNews.length > 0 && (
                    <NewsPanel items={panelNews} />
                  )}
                  {panelVoice && (
                    <VoicePanel
                      note={panelVoice}
                      onUse={(t) => {
                        setInput(t);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---- Composer ---- */}
          <div className="border-t px-4 py-3 sm:px-6 sm:py-4">
            <div className="mx-auto max-w-2xl">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`hud-panel relative overflow-hidden rounded-2xl transition-all focus-within:border-primary/50 focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_45%,transparent),0_0_28px_-10px_color-mix(in_oklab,var(--primary)_60%,transparent)] ${
                  dragOver
                    ? "border-primary/70 bg-accent/60 ring-2 ring-primary/30"
                    : ""
                }`}
              >
                {/* Top signal rail on the composer: lit while the field has
                    focus, so the input reads as the active instrument. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-70"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), transparent)",
                  }}
                />
                {dragOver ? (
                  <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-background/80">
                    <ImagePlus className="size-5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground">
                      Drop file to attach
                    </p>
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {/* Puter sign-in. Puter is the primary image provider and its
                    sign-in popup needs a genuine user gesture, so this is a
                    standalone button rather than a settings-menu item. */}
                {!puterAuth.signedIn ? (
                  <div className="px-4 pt-3">
                    <button
                      onClick={handleConnectPuter}
                      disabled={puterConnecting}
                      className="inline-flex items-center gap-1.5 rounded-full border border-foreground/25 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      <Wand2 className="size-3" />
                      {puterConnecting
                        ? "Connecting to Puter…"
                        : "Connect Puter to generate images"}
                    </button>
                  </div>
                ) : null}
                {/* Previews: image thumbnails + file chips */}
                {pendingImages.length > 0 || pendingFiles.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
                    {pendingImages.map((img, i) => (
                      <div key={img.url} className="relative inline-block">
                        <button
                          onClick={() =>
                            setLightbox({
                              images: pendingImages.map((p) => p.url),
                              index: i,
                            })
                          }
                          className="block cursor-zoom-in"
                          title="View full size"
                        >
                          <img
                            src={img.url}
                            alt={`Attachment ${i + 1}`}
                            className="h-20 w-20 rounded-lg border object-cover transition-opacity hover:opacity-90"
                          />
                        </button>
                        {img.provider ? (
                          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                            {img.provider === "puter"
                              ? "Puter"
                              : img.provider === "replicate"
                                ? "Rep"
                                : img.provider === "perchance"
                                  ? "Per"
                                  : img.provider === "pollinations"
                                    ? "Poll"
                                    : img.provider?.startsWith("hf/")
                                      ? "HF"
                                      : "Cld"}
                          </span>
                        ) : null}
                        <button
                          onClick={() =>
                            setPendingImages((prev) =>
                              prev.filter((_, j) => j !== i),
                            )
                          }
                          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                    {pendingFiles.map((file) => (
                      <div
                        key={file.url}
                        className="relative inline-flex max-w-[240px] items-center gap-2 rounded-lg border bg-background px-3 py-2"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {file.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {(file.size / 1024).toFixed(0)} KB
                        </span>
                        {/pdf/.test(file.type) ? (
                          <button
                            onClick={() => void handlePdfQuestion("")}
                            disabled={pdfBusy}
                            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                            title="Summarize this PDF with Jarvis"
                          >
                            {pdfBusy ? "Reading…" : "Summarize"}
                          </button>
                        ) : null}
                        <button
                          onClick={() =>
                            setPendingFiles((prev) =>
                              prev.filter((f) => f.url !== file.url),
                            )
                          }
                          className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                          title="Remove attachment"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {/* URL summarize input */}
                {summarizeInput && (
                  <div className="flex items-center gap-2 px-4 pt-3">
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <input
                      value={summarizeInput}
                      onChange={(e) => setSummarizeInput(e.target.value)}
                      placeholder="Paste a URL to summarize…"
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                      autoFocus
                    />
                    <button
                      onClick={() => void handleSummarizeUrl()}
                      disabled={summarizingUrl || !summarizeInput.trim()}
                      className="rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-foreground transition-colors hover:bg-accent/80 disabled:opacity-40"
                    >
                      {summarizingUrl ? <Loader2 className="size-3 animate-spin" /> : "Go"}
                    </button>
                    <button onClick={() => setSummarizeInput("")} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                      <X className="size-3" />
                    </button>
                  </div>
                )}
                {(deepResearch || modeNews || modeAnalyze) && (
                  <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-3">
                    {deepResearch ? (
                      <button
                        onClick={() => setDeepResearch(false)}
                        className="inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85"
                        title="Deep Research is on — click to turn off"
                      >
                        <Globe className="size-3" />
                        Deep Research
                        <X className="size-3 opacity-60" />
                      </button>
                    ) : null}
                    {modeNews ? (
                      <button
                        onClick={() => setModeNews(false)}
                        className="inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85"
                        title="News mode is on — your next send summarizes the topic"
                      >
                        <Newspaper className="size-3" />
                        News
                        <X className="size-3 opacity-60" />
                      </button>
                    ) : null}
                    {modeAnalyze ? (
                      <button
                        onClick={() => setModeAnalyze(false)}
                        className="inline-flex items-center gap-1 rounded-full border border-foreground/30 bg-foreground px-2.5 py-1 text-[11px] font-medium text-background transition-colors hover:bg-foreground/85"
                        title="Analyze mode is on — your next send runs NLP on the text"
                      >
                        <Languages className="size-3" />
                        Analyze
                        <X className="size-3 opacity-60" />
                      </button>
                    ) : null}
                  </div>
                )}
                <div className="relative flex items-end">
                  <div className="absolute left-1 bottom-1.5 flex items-center gap-0.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          disabled={sending}
                          title="Add — attach files, generate an image, graphs, URL summary"
                          className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                        >
                          {uploading ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium tabular-nums">
                              <Loader2 className="size-3.5 animate-spin" />
                              {uploadCount > 1 ? uploadCount : ""}
                            </span>
                          ) : (
                            <Plus className="size-4" />
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64">
                        <DropdownMenuItem onClick={() => void live.start()}>
                          <Radio className="size-3.5 text-primary" />
                          <span className="flex flex-col">
                            <span>Live voice mode</span>
                            <span className="text-[10px] text-muted-foreground">talk hands-free, full-screen HUD</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                          <Paperclip className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Attach files</span>
                            <span className="text-[10px] text-muted-foreground">PDFs, docs, images</span>
                          </span>
                        </DropdownMenuItem>
                        {/* Voice, translate and sound are icon-only on
                            desktop and live to the right of the field; below
                            sm those icons are hidden to stop the send row
                            from overflowing, so they get labelled entries here
                            instead — the features stay one tap away. */}
                        <DropdownMenuItem
                          onClick={() => {
                            setShowVoices(true);
                            setShowTranslate(false);
                            setShowSounds(false);
                          }}
                          className="sm:hidden"
                        >
                          <Volume2 className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Voice options</span>
                            <span className="text-[10px] text-muted-foreground">{describeVoice(voicePref)}</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setShowTranslate(true);
                            setShowVoices(false);
                            setShowSounds(false);
                          }}
                          className="sm:hidden"
                        >
                          <Languages className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Translate replies</span>
                            <span className="text-[10px] text-muted-foreground">answer in another language</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setShowSounds(true);
                            setShowVoices(false);
                            setShowTranslate(false);
                          }}
                          className="sm:hidden"
                        >
                          <Waves className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Sound effects</span>
                            <span className="text-[10px] text-muted-foreground">generated, not described</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleGenerateImage()} disabled={generating || !input.trim()}>
                          <Wand2 className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Generate image</span>
                            <span className="text-[10px] text-muted-foreground">from your message</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSummarizeInput("https://")}>
                          <Link2 className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Summarize a URL</span>
                            <span className="text-[10px] text-muted-foreground">any web page</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("graphing")}>
                          <FunctionSquare className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Desmos graph</span>
                            <span className="text-[10px] text-muted-foreground">y = f(x), implicit, inequalities</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("3d")}>
                          <Box className="size-3.5" />
                          <span className="flex flex-col">
                            <span>3D graph</span>
                            <span className="text-[10px] text-muted-foreground">z = f(x, y) surfaces</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("scientific")}>
                          <Calculator className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Scientific calculator</span>
                            <span className="text-[10px] text-muted-foreground">full keypad</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("fourfunction")}>
                          <Equal className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Four-function calculator</span>
                            <span className="text-[10px] text-muted-foreground">+ − × ÷</span>
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => insertDesmosBlock("geometry")}>
                          <Shapes className="size-3.5" />
                          <span className="flex flex-col">
                            <span>Geometry tool</span>
                            <span className="text-[10px] text-muted-foreground">constructions</span>
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <SlashMenu
                    open={slashOpen}
                    token={slashToken}
                    activeIndex={slashIndex}
                    onHover={setSlashIndex}
                    onSelect={applySlashCommand}
                  />
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      // Any edit invalidates the highlighted row: keeping the
                      // old index would move the selection under the user.
                      setSlashIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      recorder.recording
                        ? "Listening… click the stop square when done."
                        : editingId
                          ? "Edit your message and press Enter…"
                          : deepResearch
                            ? "Research anything on the live web…"
                            : "Message Jarvis… or / for commands"
                    }
                    rows={1}
                    className="max-h-40 w-full resize-none bg-transparent pl-12 pr-32 py-3 text-sm outline-none placeholder:text-muted-foreground/70 sm:pr-48"
                  />
                <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
                  <button
                    onClick={() => {
                      setShowVoices((v) => !v);
                      setShowTranslate(false);
                      setShowSounds(false);
                    }}
                    title={`Voice — ${describeVoice(voicePref)}`}
                    className={`hidden size-7 items-center justify-center rounded-lg transition-colors sm:inline-flex ${
                      showVoices
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <AudioLines className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setShowTranslate((v) => !v);
                      setShowVoices(false);
                      setShowSounds(false);
                    }}
                    title="Translate replies into another language"
                    className={`hidden size-7 items-center justify-center rounded-lg transition-colors sm:inline-flex ${
                      showTranslate
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Languages className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setShowSounds((v) => !v);
                      setShowVoices(false);
                      setShowTranslate(false);
                    }}
                    title="Sound effects — hear a real animal or object sound"
                    className={`hidden size-7 items-center justify-center rounded-lg transition-colors sm:inline-flex ${
                      showSounds
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Volume2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      recorder.recording
                        ? recorder.stop()
                        : void recorder.start()
                    }
                    disabled={sending || transcribing}
                    title={
                      recorder.recording
                        ? "Stop recording"
                        : "Record voice note"
                    }
                    className={`inline-flex size-7 items-center justify-center rounded-lg transition-colors ${
                      recorder.recording
                        ? "bg-destructive text-white"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    } disabled:opacity-40`}
                  >
                    {transcribing ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : recorder.recording ? (
                      <Square className="size-3" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                  </button>
                  <button
                    onClick={() => (live.active ? live.stop() : live.start())}
                    disabled={sending && !live.active}
                    title={live.active ? "Stop Live Mode" : "Live voice conversation (hands-free)"}
                    className={`inline-flex size-7 items-center justify-center rounded-lg transition-colors disabled:opacity-40 ${
                      live.active
                        ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <Radio className={`size-3.5 ${live.active ? "animate-pulse" : ""}`} />
                  </button>
                  <Button
                    size="icon-sm"
                    onClick={() => {
                      // While a reply is streaming the send button becomes Stop.
                      // One control, always in the same place, rather than a
                      // second button that appears and moves things around.
                      if (streaming) {
                        void handleStop();
                        return;
                      }
                      void runModeSend();
                    }}
                    data-send-button
                    title={streaming ? "Stop generating (Esc)" : undefined}
                    disabled={
                      streaming
                        ? false
                        : (!input.trim() &&
                              pendingImages.length === 0 &&
                              pendingFiles.length === 0 &&
                              !modeNews &&
                              !modeAnalyze &&
                              !camera.enabled) ||
                          sending ||
                          panelBusy !== null
                    }
                    className="size-7 rounded-lg"
                  >
                    {sending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ArrowUp className="size-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              </div>
              {showVoices && (
                <div className="mb-2 rounded-lg border bg-muted/30 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <AudioLines className="size-3" />
                    Voice
                    <span className="ml-1 font-normal normal-case tracking-normal">
                      — tap a name to hear it
                    </span>
                    <button
                      onClick={() => setShowVoices(false)}
                      className="ml-auto rounded p-0.5 hover:text-foreground"
                      title="Close"
                    >
                      <X className="size-3" />
                    </button>
                  </div>

                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="text-[11px] text-muted-foreground">Pace</span>
                    <input
                      type="range"
                      min={0.7}
                      max={1.4}
                      step={0.05}
                      value={voicePref.pace}
                      onChange={(e) =>
                        setVoicePref((p) => ({ ...p, pace: Number(e.target.value) }))
                      }
                      className="h-1 flex-1 accent-foreground"
                    />
                    <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                      {voicePref.pace.toFixed(2)}
                    </span>
                  </div>
                  <p className="mb-1.5 px-1 text-[10px] text-muted-foreground">
                    Pace applies to Sarvam voices; Groq and ElevenLabs set their
                    own speed.
                  </p>

                  <button
                    onClick={() => setVoicePref((p) => ({ ...p, provider: "auto" }))}
                    className={`mb-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                      voicePref.provider === "auto"
                        ? "border-foreground/30 bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    Automatic — best available voice
                  </button>

                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Sarvam — {SARVAM_SPEAKERS.length} voices
                  </p>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {SARVAM_SPEAKERS.map((speaker) => {
                      const active =
                        voicePref.provider === "sarvam" &&
                        voicePref.speaker === speaker;
                      return (
                        <button
                          key={speaker}
                          onClick={() =>
                            setVoicePref((p) => ({ ...p, provider: "sarvam", speaker }))
                          }
                          onDoubleClick={() =>
                            void previewVoice(`sarvam-${speaker}`, {
                              speaker,
                              pace: voicePref.pace,
                            })
                          }
                          title="Click to select · double-click to preview"
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${
                            active
                              ? "border-foreground/30 bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          {previewingVoice === `sarvam-${speaker}` && (
                            <Loader2 className="size-2.5 animate-spin" />
                          )}
                          {speaker}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    ElevenLabs
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {ELEVENLABS_VOICES.map((v) => {
                      const active =
                        voicePref.provider === "elevenlabs" &&
                        voicePref.voice === v.id;
                      return (
                        <button
                          key={v.id}
                          onClick={() =>
                            setVoicePref((p) => ({ ...p, provider: "elevenlabs", voice: v.id }))
                          }
                          onDoubleClick={() =>
                            void previewVoice(`el-${v.id}`, {
                              voice: v.id,
                              pace: voicePref.pace,
                            })
                          }
                          title={`${v.note} — click to select · double-click to preview`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] capitalize transition-colors ${
                            active
                              ? "border-foreground/30 bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          {previewingVoice === `el-${v.id}` && (
                            <Loader2 className="size-2.5 animate-spin" />
                          )}
                          {v.id}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {showTranslate && (
                <div className="mb-2 rounded-lg border bg-muted/30 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Languages className="size-3" />
                    Translate replies into
                    <button
                      onClick={() => setShowTranslate(false)}
                      className="ml-auto rounded p-0.5 hover:text-foreground"
                      title="Close"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {TRANSLATE_LANGUAGES.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => setTranslateTarget(lang.code)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                          translateTarget === lang.code
                            ? "border-foreground/30 bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        }`}
                      >
                        <span>{lang.native}</span>
                        <span className="text-[10px] opacity-60">{lang.name}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                    Tap the <Languages className="inline size-3" /> button on any
                    Jarvis reply to read it here. In a live call, the options
                    below let you hear and read Jarvis in this language.
                  </p>
                  <div className="mt-1.5 space-y-1 border-t pt-1.5">
                    <label className="flex cursor-pointer items-start gap-2 px-1 py-0.5 text-[11px] leading-4 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={liveTranslate.speakTranslated}
                        onChange={(e) => liveTranslate.setSpeakTranslated(e.target.checked)}
                        className="mt-0.5 size-3 accent-foreground"
                      />
                      <span>Speak live replies in this language</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 px-1 py-0.5 text-[11px] leading-4 text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={liveTranslate.answerTranslated}
                        onChange={(e) => liveTranslate.setAnswerTranslated(e.target.checked)}
                        className="mt-0.5 size-3 accent-foreground"
                      />
                      <span>Write Jarvis&apos;s replies in this language too</span>
                    </label>
                  </div>
                </div>
              )}
              {showSounds && (
                <div className="mb-2 rounded-lg border bg-muted/30 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Volume2 className="size-3" />
                    Sound effects
                    <span className="ml-1 font-normal normal-case tracking-normal">
                      — generated, not described
                    </span>
                    {sound.playing && (
                      <span className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal">
                        <Loader2 className="size-3 animate-spin" />
                        {sound.currentCue?.label}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SOUND_CUES.map((cue) => (
                      <button
                        key={cue.id}
                        onClick={() => {
                          setShowSounds(false);
                          void runSoundEffectMessage([cue], cue.label);
                        }}
                        disabled={sending}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        <span aria-hidden>{cue.emoji}</span>
                        {cue.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {live.active && (
                <div className="mb-2 rounded-lg border border-border/60 bg-muted/30 p-2">
                  <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    <Languages className="size-3" />
                    Live translation
                    {liveTranslate.translating && (
                      <span className="ml-1 inline-flex items-center gap-1 font-normal normal-case tracking-normal">
                        <Loader2 className="size-3 animate-spin" />
                        translating
                      </span>
                    )}
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 px-1 py-1 text-[11px] leading-4 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={liveTranslate.speakTranslated}
                      onChange={(e) => liveTranslate.setSpeakTranslated(e.target.checked)}
                      className="mt-0.5 size-3 accent-foreground"
                    />
                    <span>
                      <span className="text-foreground">Speak replies in {getTranslateLanguage(translateTarget)?.native ?? "another language"}</span>
                      <span className="block">
                        The transcript stays in the language Jarvis wrote it in.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 px-1 py-1 text-[11px] leading-4 text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={liveTranslate.answerTranslated}
                      onChange={(e) => liveTranslate.setAnswerTranslated(e.target.checked)}
                      className="mt-0.5 size-3 accent-foreground"
                    />
                    <span>
                      <span className="text-foreground">Answer in that language too</span>
                      <span className="block">
                        Jarvis writes the whole reply there, not just the audio.
                      </span>
                    </span>
                  </label>
                  {liveTranslate.error ? (
                    <p className="px-1 pt-1 text-[11px] text-destructive">
                      {liveTranslate.error}
                    </p>
                  ) : null}
                </div>
              )}
              {live.active && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs">
                  <Radio className={`size-3.5 text-red-500 ${live.speaking ? "" : "animate-pulse"}`} />
                  {live.speaking ? (
                    <span className="text-foreground">Jarvis speaking — interrupt anytime, just talk…</span>
                  ) : live.processing ? (
                    <span className="text-foreground">Thinking…</span>
                  ) : live.listening ? (
                    <span>
                      Listening
                      <span className="ml-2 inline-flex gap-0.5">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className="inline-block h-2.5 w-0.5 rounded-full bg-red-500"
                            style={{
                              opacity: 0.35 + Math.min(0.65, live.level * 3),
                              transform: `scaleY(${0.5 + Math.min(1.2, live.level * 6)})`,
                              transition: "transform 90ms linear",
                            }}
                          />
                        ))}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Live mode — say something</span>
                  )}
                  <button
                    onClick={live.stop}
                    className="ml-auto rounded px-1.5 py-0.5 font-medium text-red-500 transition-colors hover:bg-red-500/10"
                  >
                    End
                  </button>
                </div>
              )}
              {live.error && (
                <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {live.error}
                </div>
              )}
              {/* ---- Camera preview ----
                  Only rendered while the user has explicitly turned the camera
                  on; nothing below this point mounts otherwise. */}
              {/* The camera hook keeps its refs internal; the compiler lint
                  rule taints every property of the returned object, which is a
                  false positive — none of these reads touch a ref. */}
              {/* eslint-disable react-hooks/refs */}
              {camera.enabled && (
                <div className="mb-2 flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-2">
                  <div className="relative shrink-0 overflow-hidden rounded-md border">
                    <video
                      ref={camera.bindVideo}
                      muted
                      playsInline
                      className="h-20 w-28 object-cover"
                    />
                    <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
                      <span className="size-1.5 animate-pulse rounded-full bg-red-500" />
                      Live
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Camera vision
                    </p>
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      A single frame is captured each time you send. It is
                      attached to that message only — nothing is recorded or
                      uploaded on a timer.
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <button
                        onClick={() => void camera.enable()}
                        disabled={camera.starting}
                        className="rounded-full border px-2.5 py-1 text-[11px] transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        {camera.starting ? "Starting…" : "Restart"}
                      </button>
                      <button
                        onClick={camera.disable}
                        className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        Turn off
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* eslint-disable-enable react-hooks/refs */}
              {camera.error && (
                <div className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {camera.error}
                </div>
              )}
              {/* Wraps rather than overflowing: four pills plus the hint do
                  not fit on one line at 360px. */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-y-1.5 text-[11px] text-muted-foreground">
                {recorder.recording ? (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                    Recording{" "}
                    {Math.floor(recorder.seconds / 60)}:
                    {String(recorder.seconds % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <span className="hidden sm:inline">
                    Enter to send · Shift+Enter for newline · / for commands
                  </span>
                )}
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <button
                    onClick={() => (live.active ? live.stop() : void live.start())}
                    disabled={sending && !live.active}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      live.active
                        ? "border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20"
                        : "border-primary/40 text-primary hover:bg-primary/10"
                    }`}
                    title="Live voice mode — talk with Jarvis hands-free (full-screen HUD)"
                  >
                    <Radio className={`size-3 ${live.active ? "animate-pulse" : ""}`} />
                    {live.active ? "Live · end" : "Live"}
                  </button>
                  <button
                    onClick={() => {
                      setDeepResearch((v) => !v);
                      setModeNews(false);
                      setModeAnalyze(false);
                    }}
                    disabled={sending}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      deepResearch
                        ? "border-foreground/30 bg-foreground text-background hover:bg-foreground/85"
                        : "border-border/70 hover:bg-accent hover:text-foreground"
                    }`}
                    title="Toggle Deep Research — live web answers with citations"
                  >
                    <Globe className="size-3" />
                    Deep Research
                    {deepResearch ? <span className="size-1.5 rounded-full bg-current" /> : null}
                  </button>
                  <button
                    onClick={() => {
                      setModeNews((v) => !v);
                      setDeepResearch(false);
                      inputRef.current?.focus();
                    }}
                    disabled={panelBusy !== null || sending}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      modeNews
                        ? "border-foreground/30 bg-foreground text-background hover:bg-foreground/85"
                        : "border-border/70 hover:bg-accent hover:text-foreground"
                    }`}
                    title="Type a topic, then send — Jarvis summarizes the latest news"
                  >
                    {panelBusy === "news" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Newspaper className="size-3" />
                    )}
                    News
                  </button>
                  <button
                    onClick={() => {
                      setModeAnalyze((v) => !v);
                      setDeepResearch(false);
                      inputRef.current?.focus();
                    }}
                    disabled={panelBusy !== null || sending}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors disabled:opacity-40 ${
                      modeAnalyze
                        ? "border-foreground/30 bg-foreground text-background hover:bg-foreground/85"
                        : "border-border/70 hover:bg-accent hover:text-foreground"
                    }`}
                    title="Type text, then send — Jarvis runs NLP analysis on it"
                  >
                    {panelBusy === "nlp" ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Languages className="size-3" />
                    )}
                    Analyze
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      <Lightbox
        images={lightbox?.images ?? []}
        startIndex={lightbox?.index ?? 0}
        alt="Chat image"
        onClose={() => setLightbox(null)}
      />
      {/* Full-screen JARVIS live-mode HUD */}
      <JarvisHud
        key={live.active ? "live-on" : "live-off"}
        open={live.active}
        phase={
          live.speaking
            ? ("speaking" as HudPhase)
            : live.processing
              ? ("processing" as HudPhase)
              : live.listening
                ? ("listening" as HudPhase)
                : ("idle" as HudPhase)
        }
        level={live.level}
        transcript={liveTranscript}
        language={getCountry(countryCode).name}
        mood={live.mood}
        energy={live.level}
        cameraStream={live.cameraStream}
        gesturesEnabled={orbGestures}
        onToggleGestures={() => setOrbGestures((v) => !v)}
        muted={live.muted}
        onGestureAction={handleOrbGesture}
        wakeGated={wakeGate}
        onToggleWake={() => setWakeGate((v) => !v)}
        onStop={() => {
          live.stop();
          setLiveTranscript([]);
        }}
        onSkip={() => live.skipSpeaking()}
        paused={live.paused}
        onResume={() => live.resumeListening()}
        autoRestart={live.autoRestart}
        onToggleAutoRestart={() => live.setAutoRestart(!live.autoRestart)}
        noiseCancel={live.noiseCancel}
        onToggleNoiseCancel={() => live.setNoiseCancel(!live.noiseCancel)}
        echoCancelling={live.echoCancelling}
        voiceOptions={voiceOptions ?? null}
        voice={voicePref.voice ?? ""}
        onVoiceChange={(voice) =>
          setVoicePref((p) => ({ ...p, voice, speaker: undefined }))
        }
        pace={voicePref.pace}
        onPaceChange={(pace) => setVoicePref((p) => ({ ...p, pace }))}
        providerHealth={<ProviderHealth />}
        onOpenTuning={() => setShowTuning(true)}
      />
      <LiveTuning
        live={live}
        open={live.active && showTuning}
        onClose={() => setShowTuning(false)}
      />

      {/* ---- New surfaces: palette, instructions, schedules ---- */}
      <CommandPalette
        open={showPalette}
        onOpenChange={setShowPalette}
        commands={paletteCommands}
      />
      <PersonaPanel open={showPersona} onOpenChange={setShowPersona} />
      <ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
      <PassphraseGate
        mode={passphraseOpen}
        salt={keyMaterial?.salt ?? null}
        verifier={keyMaterial?.verifier ?? null}
        onClose={() => setPassphraseOpen(null)}
        onUnlocked={() => setPassphraseOpen(null)}
      />
      <EnginePanel open={showEngines} onClose={() => setShowEngines(false)} />
      <PluginsDialog
        open={showPlugins}
        onClose={() => setShowPlugins(false)}
        onOpenSkill={(pluginId, skillName) =>
          handleOpenSkillFromDialog(pluginId as Id<"plugins">, skillName)
        }
      />
      <McpPanel open={showMcp} onClose={() => setShowMcp(false)} />
      <IntegrationsPanel
        open={showIntegrations}
        onClose={() => setShowIntegrations(false)}
        onOpenPanel={(panel: IntegrationPanel) => {
          if (panel === "mcp") setShowMcp(true);
          else if (panel === "plugins") setShowPlugins(true);
          else if (panel === "voices") setShowVoices(true);
          else if (panel === "studio") setShowStudio((v) => !v);
          else if (panel === "code") setShowCode((v) => !v);
          else if (panel === "memory") setShowMemory((v) => !v);
          else if (panel === "calculator") setShowCalculator((v) => !v);
          else if (panel === "translate") setShowTranslate(true);
          else if (panel === "tasks") setShowTasks(true);
          else if (panel === "sounds") setShowSounds(true);
          else if (panel === "live") setShowLivePanel(true);
        }}
      />
      <PinnedPanel
        open={showPins}
        onClose={() => setShowPins(false)}
        onOpenMessage={openPinned}
      />
      {compareState ? (
        <BranchCompare
          open
          left={compareState.left}
          right={compareState.right}
          onClose={() => setCompareState(null)}
        />
      ) : null}
      {listening.active ? (
        <button
          type="button"
          onClick={listening.stop}
          className="fixed bottom-24 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/40 bg-background/90 px-3 py-1.5 text-[11px] text-primary shadow-lg backdrop-blur transition-colors hover:bg-primary/10"
        >
          <Loader2 className="size-3 animate-spin" />
          Reading the conversation
          <span className="text-muted-foreground">
            {listening.remaining} left
          </span>
          <span className="text-muted-foreground/70">stop</span>
        </button>
      ) : null}
      <LiveSessionPanel
        open={showLivePanel}
        onClose={() => setShowLivePanel(false)}
      />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything after it on this branch is deleted too, since the rest
              of the conversation no longer makes sense without it. Earlier
              forks are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = confirmDelete;
                setConfirmDelete(null);
                if (id) void handleDeleteMessage(id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TasksPanel
        open={showTasks}
        onOpenChange={setShowTasks}
        sessionId={activeId}
        onOpenSession={(sessionId) => {
          setActiveId(sessionId);
          setActiveBranchId(null);
        }}
      />
    </TooltipProvider>

    <footer className="border-t px-4 py-3">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-muted-foreground/70">
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Terms
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <Link to="/resources" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Resources & developers
          </Link>
          <span className="text-muted-foreground/40">·</span>
          <Link to="/auth" className="underline underline-offset-2 hover:text-foreground transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  </div>
  );
}
