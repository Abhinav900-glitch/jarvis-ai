import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { highlightCode } from "@/lib/highlight";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Eraser,
  FileText,
  Info,
  Laptop,
  Loader2,
  Package,
  Play,
  Send,
  Terminal,
  X,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CODE_LANGUAGES,
  DEFAULT_CODE_LANGUAGE,
  getCodeLanguage,
} from "@/lib/code-languages";
import {
  buildRunPrompt,
  PROVIDER_LABELS,
  type CodeRunResult,
  type EngineStatus,
  type EngineProbe,
} from "@/lib/code-run";
import {
  searchStarters,
  STARTER_CATEGORIES,
  type StarterProgram,
} from "@/lib/starter-code";
import { colabWorkerCell } from "@/lib/colab-worker";

const INDENT = "  ";

/** How each probe verdict is worded and coloured. */
/** The runner installs at most this many packages for one run. */
const MAX_INSTALLS = 8;

/**
 * The package names inside a `pip install …` line.
 *
 * The box is typed the way a shell is typed, so the words that are the command
 * rather than an argument (`pip`, `install`, `!`) are dropped and anything
 * starting with `-` is left to pip. The list is capped where the runner caps
 * it, so a ninth name is a visible limit rather than a silent omission.
 */
function parsePackages(raw: string): string[] {
  const words = raw
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const names = words.filter(
    (word) =>
      !/^(pip|pip3|python|python3|npm|install|i|add|-m|!)$/i.test(word) &&
      !word.startsWith("-"),
  );
  return [...new Set(names)].slice(0, MAX_INSTALLS);
}

const PROBE_LABELS: Record<EngineProbe["state"], string> = {
  ok: "working",
  rejected: "key rejected",
  limited: "quota or rate limit",
  down: "not working",
  unsupported: "cannot run this language",
  unconfigured: "no key saved",
};

const PROBE_STYLES: Record<
  EngineProbe["state"],
  { icon: React.ReactNode; text: string }
> = {
  ok: {
    icon: <Check className="size-3 shrink-0 text-emerald-500" />,
    text: "text-emerald-600 dark:text-emerald-400",
  },
  rejected: {
    icon: <AlertTriangle className="size-3 shrink-0 text-rose-500" />,
    text: "text-rose-600 dark:text-rose-400",
  },
  limited: {
    icon: <AlertTriangle className="size-3 shrink-0 text-amber-500" />,
    text: "text-amber-600 dark:text-amber-400",
  },
  down: {
    icon: <X className="size-3 shrink-0 text-rose-500" />,
    text: "text-rose-600 dark:text-rose-400",
  },
  unsupported: {
    icon: <Info className="size-3 shrink-0 text-muted-foreground" />,
    text: "text-muted-foreground",
  },
  unconfigured: {
    icon: <Info className="size-3 shrink-0 text-muted-foreground" />,
    text: "text-muted-foreground",
  },
};

/**
 * How long ago the worker last polled.
 *
 * A polling machine has no other way to say it is alive, so the panel reports
 * the check-in itself rather than a bare "offline": "checked in 4 min ago" is
 * a diagnosis (the tab was closed) and "offline" is only a symptom.
 */
function sinceLabel(lastSeenAt: number): string {
  if (!lastSeenAt) return "the notebook has not checked in yet";
  const seconds = Math.max(0, Math.round((Date.now() - lastSeenAt) / 1000));
  if (seconds < 90) return `checked in ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `checked in ${minutes} min ago`;
}

function formatKb(raw: string | null): string {
  const bytes = Number(raw);
  if (raw === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function CodePanel({
  onClose,
  onSendToJarvis,
  onOpenSkillPicker,
  skill,
  setSkill,
  skillCopied,
  setSkillCopied,
  onEditorInserted,
}: {
  onClose: () => void;
  /** Hands a composed message to the chat so the model can interpret the run. */
  onSendToJarvis: (text: string) => void;
  /** Opens the dashboard's stored-plugin skill picker. */
  onOpenSkillPicker?: () => void;
  skill: {
    skillName: string;
    text: string;
    bytes: number;
  } | null;
  setSkill: (skill: {
    skillName: string;
    text: string;
    bytes: number;
  } | null) => void;
  skillCopied: boolean;
  setSkillCopied: (copied: boolean) => void;
  onEditorInserted?: () => void;
}) {
  const runCode = useAction(api.codeRunner.runCode);
  const getRunnerStatus = useAction(api.codeRunner.runnerStatus);
  const probeEngines = useAction(api.codeRunner.probeEngines);

  const machine = useQuery(api.machines.myMachine);
  const connectMachine = useAction(api.machines.connect);
  const disconnectMachine = useMutation(api.machines.disconnect);
  const [showCell, setShowCell] = useState(false);
  const [cellCopied, setCellCopied] = useState(false);
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineError, setMachineError] = useState<string | null>(null);

  // The cell is derived, not stored: rotating the token or moving deployments
  // changes it, and a stale copy in the clipboard would connect to nothing.
  const cell = useMemo(
    () =>
      machine?.token && machine.endpoint
        ? colabWorkerCell({ token: machine.token, endpoint: machine.endpoint })
        : null,
    [machine],
  );

  const connectColab = async () => {
    if (machineBusy) return;
    setMachineBusy(true);
    setMachineError(null);
    try {
      await connectMachine();
      setShowCell(true);
    } catch (err) {
      setMachineError(
        err instanceof Error ? err.message : "The machine could not be connected.",
      );
    } finally {
      setMachineBusy(false);
    }
  };

  const removeMachine = async () => {
    setMachineBusy(true);
    try {
      await disconnectMachine();
      setShowCell(false);
    } catch {
      setMachineError("The machine could not be removed.");
    } finally {
      setMachineBusy(false);
    }
  };

  const copyCell = async () => {
    if (!cell) return;
    try {
      await navigator.clipboard.writeText(cell);
      setCellCopied(true);
      setTimeout(() => setCellCopied(false), 2000);
    } catch {
      setMachineError("Copying was blocked — select the cell text and copy it by hand.");
    }
  };

  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  const [showEngines, setShowEngines] = useState(false);
  const [checkingEngines, setCheckingEngines] = useState(false);

  const [probes, setProbes] = useState<EngineProbe[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const refreshEngines = async () => {
    if (checkingEngines) return;
    setCheckingEngines(true);
    try {
      const status = await getRunnerStatus();
      setEngines(status.engines);
    } catch {
      setEngines(null);
    } finally {
      setCheckingEngines(false);
    }
  };

  const runSelfTest = async () => {
    if (probing) return;
    setProbing(true);
    setProbeError(null);
    try {
      const report = await probeEngines({ language: languageId });
      setProbes(report.engines);
      setEngines(null);
    } catch (err) {
      setProbeError(
        err instanceof Error ? err.message : "The self-test could not be started.",
      );
    } finally {
      setProbing(false);
    }
  };

  const toggleEngines = () => {
    const next = !showEngines;
    setShowEngines(next);
    if (next && !engines) void refreshEngines();
  };

  const [languageId, setLanguageId] = useState(DEFAULT_CODE_LANGUAGE);
  const [versionIndex, setVersionIndex] = useState<number | undefined>(undefined);
  const [source, setSource] = useState("");
  /**
   * Packages installed before the run, typed the way pip is typed.
   *
   * `pip install numpy pandas` is what people already know, so the box accepts
   * exactly that (or the bare names, or a comma-separated list) and the
   * installers read the names out of it. It used to be invisible state that a
   * starter set and any keystroke in the editor dropped; a field you can see
   * and edit is the only way "it said numpy was missing" becomes fixable here.
   */
  const [packageInput, setPackageInput] = useState("");
  const [showPackages, setShowPackages] = useState(false);
  const [stdin, setStdin] = useState("");
  const [showStdin, setShowStdin] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [outputCopied, setOutputCopied] = useState(false);

  const handleOpenSkill = useCallback(() => {
    // Opens the dashboard's skill picker; the chosen skill is fetched there and
    // handed back through the `skill` prop.
    onOpenSkillPicker?.();
  }, [onOpenSkillPicker]);

  // Starter library.
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCategory, setLibraryCategory] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLPreElement>(null);

  const language = useMemo(
    () => getCodeLanguage(languageId) ?? CODE_LANGUAGES[0],
    [languageId],
  );

  /** pip for Python, npm for Node — the engines that can install at all. */
  const installer =
    language.id === "python3" ? "pip" : language.id === "nodejs" ? "npm" : null;

  const libs = useMemo(() => parsePackages(packageInput), [packageInput]);
  const version =
    language.versions.find((v) => v.index === versionIndex) ??
    language.versions[language.defaultVersion] ??
    language.versions[0];

  const starters = useMemo(() => {
    const found = searchStarters(libraryQuery);
    return libraryCategory ? found.filter((p) => p.category === libraryCategory) : found;
  }, [libraryQuery, libraryCategory]);

  // Switching language resets the version, because the index is a position in
  // that language's own list and carries no meaning across languages.
  const chooseLanguage = (next: string) => {
    setLanguageId(next);
    setVersionIndex(undefined);
    const target = getCodeLanguage(next);
    if (target && !target.stdin) setShowStdin(false);
  };

  const loadStarter = (program: StarterProgram) => {
    chooseLanguage(program.language);
    setVersionIndex(program.versionIndex);
    setSource(program.code);
    setPackageInput((program.libs ?? []).join(" "));
    setShowPackages((program.libs ?? []).length > 0);
    setResult(null);
    setShowLibrary(false);
    window.setTimeout(() => editorRef.current?.focus(), 60);
  };

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const run = await runCode({
        language: language.id,
        versionIndex: version.index,
        sourceCode: source,
        stdin: stdin.trim() ? stdin : undefined,
        libs: libs.length ? libs : undefined,
      });
      setResult(run);
    } catch (err) {
      setResult({
        ok: false,
        provider: null,
        providersTried: [],
        language: language.id,
        languageLabel: language.label,
        versionIndex: version.index,
        versionLabel: version.label,
        output: "",
        error: "",
        failed: false,
        timedOut: false,
        cpuTime: null,
        memory: null,
        elapsedMs: 0,
        outputTruncated: false,
        requestError:
          err instanceof Error ? err.message : "The run could not be started.",
        engineNote: null,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleSend = () => {
    if (!result) return;
    onSendToJarvis(
      buildRunPrompt({
        languageLabel: language.label,
        versionLabel: version.label,
        fence: language.fence,
        source,
        stdin: stdin.trim() ? stdin : undefined,
        result,
      }),
    );
  };

  const handleCopy = async () => {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleCopyOutput = async () => {
    const text = result
      ? [result.output, result.error].filter(Boolean).join("\n")
      : "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setOutputCopied(true);
      window.setTimeout(() => setOutputCopied(false), 1600);
    } catch {
      setOutputCopied(false);
    }
  };

  // Tab inserts spaces rather than leaving the editor, and the caret lands
  // after them. Shift+Tab still moves focus out, so the panel stays usable
  // from the keyboard alone.
  const handleEditorKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void handleRun();
      return;
    }
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    const el = event.currentTarget;
    const { selectionStart, selectionEnd, value } = el;
    setSource(`${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`);
    setResult(null);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + INDENT.length;
    });
  };

  const onSourceChange = (value: string) => {
    setSource(value);
    // Editing invalidates whatever the console is still showing.
    setResult(null);
  };

  // The packages field is the user's now, so editing the code leaves it alone:
  // dropping what a starter asked for is right only while it is invisible.
  const handleEdit = (value: string) => {
    onSourceChange(value);
  };

  // The gutter renders one div per line, so cap it rather than laying out
  // thousands of nodes for a very long program.
  const lineCount = Math.min(source ? source.split("\n").length : 1, 400);

  // The editor's own fence tag drives highlighting; when the build has no
  // grammar for it (or highlighting fails) highlightCode falls back to
  // escaped plain text, so the mirror is always valid HTML.
  const highlightedHtml = useMemo<string | null>(
    () => (typeof window !== "undefined" ? null : highlightCode(source, language.fence)),
    // Force a re-computation whenever the source or the language changes, so
    // the mirror tracks edits as you type.
    [source, language.fence],
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="border-t px-4 py-3 sm:px-6"
    >
      <div className="mx-auto max-w-4xl">
        {/* ---- Header ---- */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Code2 className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Code runner
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {language.label} {version.label}
          </span>
          {libs.length > 0 && (
            <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
              installs {libs.join(", ")}
            </span>
          )}
          <button
            onClick={toggleEngines}
            className="ml-auto flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
            title="Which execution engines are available"
          >
            <Loader2
              className={cn(
                "size-3",
                checkingEngines && "animate-spin",
              )}
            />
            Engines
            {engines && (
              <span className="tabular-nums">
                {engines.filter((e) => e.configured).length}/{engines.length}
              </span>
            )}
          </button>
          {result && (
            <span className="ml-1 flex items-center gap-2 text-[10px] text-muted-foreground/70">
              <span className={result.failed ? "text-amber-500" : "text-emerald-500"}>
                {result.timedOut
                  ? "timed out"
                  : result.failed
                    ? "failed"
                    : "ran"}
              </span>
              {result.provider && (
                <span
                  className="rounded bg-muted px-1 py-px"
                  title={
                    result.providersTried.length > 1
                      ? `Tried ${result.providersTried
                          .map((p) => PROVIDER_LABELS[p])
                          .join(", then ")}`
                      : "Execution engine"
                  }
                >
                  {PROVIDER_LABELS[result.provider]}
                </span>
              )}
              {result.cpuTime && <span>{result.cpuTime}s CPU</span>}
              {result.memory && <span>{formatKb(result.memory)}</span>}
            </span>
          )}
          <button
            onClick={onClose}
            className="ml-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* ---- Controls ---- */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Select value={language.id} onValueChange={chooseLanguage}>
            <SelectTrigger className="h-7 w-[9.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODE_LANGUAGES.map((lang) => (
                <SelectItem key={lang.id} value={lang.id} className="text-xs">
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(version.index)}
            onValueChange={(next) => setVersionIndex(Number(next))}
          >
            <SelectTrigger className="h-7 w-[8.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {language.versions.map((v) => (
                <SelectItem key={v.index} value={String(v.index)} className="text-xs">
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {language.stdin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowStdin((v) => !v)}
            >
              <Terminal className="size-3.5" />
              stdin
              {showStdin ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>
          )}

          {installer ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowPackages((v) => !v)}
              title={`Install ${installer === "pip" ? "Python" : "Node"} packages before the run`}
            >
              <Package className="size-3.5" />
              {installer} install
              {libs.length > 0 ? (
                <span className="tabular-nums text-primary">{libs.length}</span>
              ) : null}
              {showPackages ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>
          ) : null}            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setShowLibrary((v) => !v)}
            >
              <BookOpen className="size-3.5" />
              Examples
              {showLibrary ? (
                <ChevronUp className="size-3" />
              ) : (
                <ChevronDown className="size-3" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleOpenSkill}
              disabled={!onOpenSkillPicker}
              title="Insert a writing skill from a stored plugin"
            >
              <BookOpen className="size-3.5" />
              Skills
            </Button>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Copy code"
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Clear"
              onClick={() => {
                setSource("");
                setResult(null);
                editorRef.current?.focus();
              }}
            >
              <Eraser className="size-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => void handleRun()}
              disabled={running || !source.trim()}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="size-3.5" />
              )}
              {running ? "Running" : "Run"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={handleSend}
              disabled={!result}
              title="Send the program and its output to Jarvis to interpret"
            >
              <Send className="size-3.5" />
              Ask Jarvis
            </Button>
          </div>
        </div>

        {/* ---- Engine availability ---- */}
        {showEngines && (
          <div className="mb-2 rounded-lg border bg-muted/20 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Execution engines
              </span>
              <button
                onClick={() => void refreshEngines()}
                disabled={checkingEngines}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                title="Check again"
              >
                <Loader2
                  className={cn("size-3", checkingEngines && "animate-spin")}
                />
              </button>
            </div>

            {/* ---- The user's own machine ---- */}
            <div className="mb-2 rounded-md border border-dashed bg-background/60 p-2">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <Laptop className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">Your Colab machine</span>
                <span
                  className={cn(
                    "ml-auto",
                    !machine
                      ? "text-muted-foreground"
                      : machine.online
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {!machine ? "not connected" : machine.online ? "online" : "offline"}
                </span>
              </div>

              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {!machine
                  ? "Run Python on your own notebook rather than a sandbox: any pip package, real files, and a GPU if your plan has one. Colab has no API, so the connection runs the other way — you paste a worker into the notebook and it fetches work from here."
                  : machine.online
                    ? `${machine.platform ?? machine.version ?? "Python"} · ${sinceLabel(
                        machine.lastSeenAt,
                      )} · ${machine.jobsRun} run${machine.jobsRun === 1 ? "" : "s"}. Python runs go here first and fall back to the sandbox if the notebook closes.`
                    : `${sinceLabel(
                        machine.lastSeenAt,
                      )}. Run the cell in Colab again and this goes back to online.`}
              </p>

              <div className="mt-1.5 flex flex-wrap gap-1">
                {machine ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => setShowCell((open) => !open)}
                    >
                      {showCell ? "Hide cell" : "Show cell"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void connectColab()}
                      disabled={machineBusy}
                      title="Replace the token so an old notebook can no longer fetch work"
                    >
                      New token
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void removeMachine()}
                      disabled={machineBusy}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => void connectColab()}
                    disabled={machineBusy}
                  >
                    {machineBusy && <Loader2 className="mr-1 size-3 animate-spin" />}
                    Connect Colab
                  </Button>
                )}
              </div>

              {showCell && cell && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      Paste into a Colab cell, run it, keep the tab open.
                    </span>
                    <button
                      onClick={() => void copyCell()}
                      className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {cellCopied ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {cellCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded border bg-muted/40 p-2 text-[10px] leading-snug">
                    {cell}
                  </pre>
                </div>
              )}

              {machineError && (
                <p className="mt-1 flex gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{machineError}</span>
                </p>
              )}
            </div>

            {!engines ? (
              <p className="text-[11px] text-muted-foreground">
                Could not read the engine configuration.
              </p>
            ) : (
              <div className="space-y-1">
                {engines.map((engine) => {
                  const usable = engine.configured;
                  return (
                    <div key={engine.provider} className="text-[11px] leading-snug">
                      <div className="flex items-center gap-1.5">
                        {usable ? (
                          <Check className="size-3 shrink-0 text-emerald-500" />
                        ) : (
                          <X className="size-3 shrink-0 text-amber-500" />
                        )}
                        <span className="font-medium">{engine.label}</span>
                        <span className="text-muted-foreground">
                          {usable
                            ? "ready"
                            : engine.envNames.length
                              ? "no key found"
                              : "no compiler for this language"}
                        </span>
                      </div>
                      {engine.problem && (
                        <p className="ml-5 text-muted-foreground">
                          {engine.problem}
                        </p>
                      )}
                      {!usable &&
                        !engine.problem &&
                        engine.unsupported.length > 0 && (
                          <p className="ml-5 text-muted-foreground">
                            Cannot run {engine.unsupported.join(", ")}.
                          </p>
                        )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 border-t pt-2">
              <Button
                onClick={() => void runSelfTest()}
                disabled={probing}
                size="sm"
                variant="outline"
                className="h-6 w-full text-[11px]"
              >
                {probing ? (
                  <Loader2 className="mr-1.5 size-3 animate-spin" />
                ) : (
                  <Play className="mr-1.5 size-3" />
                )}
                {probing ? "Testing engines…" : "Test all engines"}
              </Button>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground/70">
                Runs a known-good program through each engine so a saved but
                broken key is distinguishable from a working one. Uses one run
                from each provider's quota.
              </p>
            </div>

            {probeError && (
              <p className="mt-2 flex gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>{probeError}</span>
              </p>
            )}

            {probes && (
              <div className="mt-2 space-y-1 border-t pt-2">
                {probes.map((probe) => (
                  <div key={probe.provider} className="text-[11px] leading-snug">
                    <div className="flex items-center gap-1.5">
                      {PROBE_STYLES[probe.state].icon}
                      <span className="font-medium">{probe.label}</span>
                      <span className={PROBE_STYLES[probe.state].text}>
                        {PROBE_LABELS[probe.state]}
                      </span>
                      {probe.ms !== null && (
                        <span className="tabular-nums text-muted-foreground/60">
                          {(probe.ms / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <p className="ml-5 text-muted-foreground">{probe.detail}</p>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2 border-t pt-1.5 text-[10px] leading-snug text-muted-foreground/70">
              Keys are read on the server and never sent to the browser. Engines
              are tried in order and the first one that runs your program ends
              the chain, so a working engine is used even if an earlier one is
              unavailable.
            </p>
          </div>
        )}

        {/* ---- Starter library ---- */}
        {showLibrary && (
          <div className="mb-2 rounded-lg border bg-muted/20 p-2">
            <input
              value={libraryQuery}
              onChange={(e) => setLibraryQuery(e.target.value)}
              placeholder="Search examples — hello world, sorting, neural net, GPT…"
              className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                onClick={() => setLibraryCategory(null)}
                className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                  libraryCategory === null
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {STARTER_CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() =>
                    setLibraryCategory(libraryCategory === category ? null : category)
                  }
                  className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                    libraryCategory === category
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {starters.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  Nothing matches "{libraryQuery}".
                </p>
              )}
              {starters.map((program) => (
                <button
                  key={program.id}
                  onClick={() => loadStarter(program)}
                  className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{program.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                        {getCodeLanguage(program.language)?.label ?? program.language}
                      </span>
                      {program.libs?.length ? (
                        <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                          +{program.libs.join(", ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {program.blurb}
                    </p>
                  </div>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">
                    {program.level}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}          {skill && (
            <div className="mb-2 flex items-center gap-2">
              <BookOpen className="size-3.5 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Writing skill loaded
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {skill.skillName}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {formatKb(String(skill.bytes))}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  setSource((prev) => `${prev.trimEnd()}\n\n${skill.text}`);
                  setSkill(null);
                  onEditorInserted?.();
                }}
              >
                <FileText className="size-3" />
                Insert into editor
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Copy skill text"
                onClick={() => {
                  void navigator.clipboard.writeText(skill.text);
                  setSkillCopied(true);
                  window.setTimeout(() => setSkillCopied(false), 1600);
                }}
              >
                {skillCopied ? (
                  <Check className="size-3 text-emerald-500" />
                ) : (
                  <Copy className="size-3" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Dismiss skill"
                onClick={() => {
                  setSkill(null);
                  onEditorInserted?.();
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
          )}

          {!skill && (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground/70">
              <span>No writing skill loaded.</span>
              <span className="font-mono">Ctrl/Cmd + B</span>
              <span>to open the skill picker.</span>
            </div>
          )}

          {/* ---- Editor ---- */}
          <div className="flex overflow-hidden rounded-lg border bg-background">
            {/* Line-number gutter: one div per line, mirrored width. */}
            <div
              aria-hidden
              className="select-none overflow-hidden border-r bg-muted/40 px-2 py-2 text-right font-mono text-[11px] leading-[1.45rem] text-muted-foreground/50"
            >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>

          {/* Editor with a syntax-highlighted mirror underneath the text. */}
          <div className="relative flex min-w-0 flex-1">
            <pre
              ref={mirrorRef}
              className="pointer-events-none absolute inset-0 z-0 m-0 flex max-w-none grow basis-0 overflow-hidden rounded-none border-0 bg-transparent p-0 font-mono text-[12.5px] leading-[1.45rem] md:text-[12.5px] whitespace-pre-wrap break-words code-hl"
              aria-hidden="true"
            >
              {highlightedHtml ? (
                <code
                  dangerouslySetInnerHTML={{
                    __html: highlightedHtml,
                  }}
                />
              ) : null}
            </pre>
            <Textarea
              ref={editorRef}
              value={source}
              onChange={(e) => handleEdit(e.target.value)}
              onKeyDown={handleEditorKeyDown}
              onScroll={(e) => {
                const pre = mirrorRef.current;
                if (pre) pre.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={
                "Write code here, or open Examples to start from a program.\n" +
                "Ctrl/Cmd + Enter runs it."
              }
              className="relative z-10 min-h-44 max-h-72 resize-y rounded-none border-0 bg-transparent px-3 py-2 text-[12.5px] leading-[1.45rem] font-mono text-transparent caret-foreground md:text-[12.5px] placeholder:text-muted-foreground/40 focus-visible:ring-0"
            />
          </div>
        </div>

        {/* ---- stdin ---- */}
        {/* ---- Packages ---- */}
        {showPackages && installer ? (
          <div className="mt-2">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {installer === "pip" ? "Python packages (pip)" : "Node packages (npm)"}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                installed before the run — an engine that cannot install says so
              </span>
            </div>
            <Input
              value={packageInput}
              onChange={(e) => setPackageInput(e.target.value)}
              spellCheck={false}
              placeholder={
                installer === "pip"
                  ? "pip install numpy pandas"
                  : "npm install express"
              }
              className="h-8 font-mono text-xs"
            />
            {libs.length > 0 ? (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {libs.map((name) => (
                  <span
                    key={name}
                    className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                  >
                    {name}
                  </span>
                ))}
                {parsePackages(packageInput).length === MAX_INSTALLS ? (
                  <span className="text-[10px] text-muted-foreground/60">
                    {MAX_INSTALLS} at a time
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {showStdin && language.stdin && (
          <div className="mt-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Input (stdin)
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {language.comment} a program that reads input needs it, or it waits
              </span>
            </div>
            <Textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              spellCheck={false}
              placeholder="One line, or as many as the program reads…"
              className="min-h-14 resize-y font-mono text-xs"
            />
          </div>
        )}

        {/* ---- Output console ---- */}
        {result && (
          <div className="mt-2 overflow-hidden rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 border-b px-2 py-1">
              <Terminal className="size-3 text-muted-foreground" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Output
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {(result.elapsedMs / 1000).toFixed(1)}s round trip
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Copy output"
                onClick={() => void handleCopyOutput()}
              >
                {outputCopied ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto p-2 font-mono text-[12px] leading-[1.45rem]">
              {result.requestError ? (
                <p className="flex gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{result.requestError}</span>
                </p>
              ) : null}

              {result.engineNote ? (
                <p className="mb-1.5 flex gap-1.5 text-[11px] leading-snug text-muted-foreground">
                  <Info className="mt-px size-3 shrink-0" />
                  <span>{result.engineNote}</span>
                </p>
              ) : null}

              {result.outputTruncated ? (
                <p className="mb-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  This engine cuts long output off, so the run may look like it
                  stopped early.
                </p>
              ) : null}

              {result.output ? (
                <pre className="whitespace-pre-wrap break-words text-foreground">
                  {result.output}
                </pre>
              ) : null}

              {result.error ? (
                <pre className="whitespace-pre-wrap break-words text-rose-600 dark:text-rose-400">
                  {result.error}
                </pre>
              ) : null}

              {!result.requestError && !result.output && !result.error ? (
                <p className="text-muted-foreground">
                  The program finished without printing anything.
                </p>
              ) : null}
            </div>
          </div>
        )}

        {!result && !running && (
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Nothing has been run yet. Press{" "}
            <span className="font-mono">Ctrl/Cmd + Enter</span> to run, then{" "}
            <span className="font-mono">Ask Jarvis</span> to have the result read back
            to you.
          </p>
        )}
      </div>
    </motion.div>
  );
}
