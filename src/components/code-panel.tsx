import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Eraser,
  Info,
  Loader2,
  Play,
  Send,
  Terminal,
  X,
} from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/lib/code-run";
import {
  searchStarters,
  STARTER_CATEGORIES,
  type StarterProgram,
} from "@/lib/starter-code";

const INDENT = "  ";

function formatKb(raw: string | null): string {
  const bytes = Number(raw);
  if (raw === null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function CodePanel({
  onClose,
  onSendToJarvis,
}: {
  onClose: () => void;
  /** Hands a composed message to the chat so the model can interpret the run. */
  onSendToJarvis: (text: string) => void;
}) {
  const runCode = useAction(api.codeRunner.runCode);

  const [languageId, setLanguageId] = useState(DEFAULT_CODE_LANGUAGE);
  const [versionIndex, setVersionIndex] = useState<number | undefined>(undefined);
  const [source, setSource] = useState("");
  /** Packages JDoodle installs before the run, carried over from a starter. */
  const [libs, setLibs] = useState<string[]>([]);
  const [stdin, setStdin] = useState("");
  const [showStdin, setShowStdin] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Starter library.
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCategory, setLibraryCategory] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);

  const language = useMemo(
    () => getCodeLanguage(languageId) ?? CODE_LANGUAGES[0],
    [languageId],
  );
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
    setLibs(program.libs ?? []);
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
    setLibs([]);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + INDENT.length;
    });
  };

  const onSourceChange = (value: string) => {
    setSource(value);
    // Editing invalidates whatever the console is still showing.
    setResult(null);
  };

  // A hand-edited program is no longer the one the starter described, so the
  // packages it asked for are dropped rather than installed uninvited.
  const handleEdit = (value: string) => {
    onSourceChange(value);
    setLibs([]);
  };

  // The gutter renders one div per line, so cap it rather than laying out
  // thousands of nodes for a very long program.
  const lineCount = Math.min(source ? source.split("\n").length : 1, 400);

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
        <div className="mb-2 flex items-center gap-2">
          <Code2 className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Code runner
          </span>              <span className="text-[10px] text-muted-foreground/60">
                {language.label} {version.label}
              </span>
              {libs.length > 0 && (
                <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                  installs {libs.join(", ")}
                </span>
              )}
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
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
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

          <Button
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
                  Nothing matches “{libraryQuery}”.
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
        )}

        {/* ---- Editor ---- */}
        <div className="flex overflow-hidden rounded-lg border bg-background">
          <div
            aria-hidden
            className="select-none overflow-hidden border-r bg-muted/40 px-2 py-2 text-right font-mono text-[11px] leading-[1.45rem] text-muted-foreground/50"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <Textarea
            ref={editorRef}
            value={source}
            onChange={(e) => handleEdit(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={
              "Write code here, or open Examples to start from a program.\n" +
              "Ctrl/Cmd + Enter runs it."
            }
            className="max-h-72 min-h-44 resize-y rounded-none border-0 font-mono text-[12.5px] leading-[1.45rem] focus-visible:ring-0 md:text-[12.5px]"
          />
        </div>

        {/* ---- stdin ---- */}
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
                  This engine caps output at 999 characters, so it may stop mid-run.
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
