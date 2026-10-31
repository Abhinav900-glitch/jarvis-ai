// ---------------------------------------------------------------------------
// AeroTransformGen Dev — the console.
//
// Three views the Work tab has no room for, each answering "what is it
// actually doing?" at a different depth:
//
//   AgentConsole      what happened — every model round and tool call, in
//                     order, written as it happens rather than at the end.
//   TraceInspector    what was sent — the request and reply behind a round,
//                     recorded only while the run's `debug` flag is on, since
//                     bodies are the largest strings this feature stores.
//   WorkspacePreview  what it produced — the workspace assembled into a page
//                     and run sandboxed, with the page's own console captured
//                     underneath, because a preview you cannot see the errors
//                     of is a screenshot.
//
// Nothing here talks to the model or the store directly: the panel hands over
// already-subscribed rows, so these components render and call back, nothing
// else.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileCode, Files, RotateCw, Terminal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
 * Shapes. Structurally compatible with the Convex documents, declared here so
 * the console does not import the generated data model and drift with it.
 * ------------------------------------------------------------------------- */

interface ConsoleEntry {
  at: number;
  kind: "model" | "tool";
  label: string;
  detail?: string;
  ms?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface TraceEntry {
  round: number;
  engineId?: string;
  model?: string;
  ms?: number;
  promptTokens?: number;
  completionTokens?: number;
  request?: string;
  response?: string;
  toolCalls?: string;
}

export interface ConsoleStep {
  _id: string;
  position: number;
  title: string;
  status: string;
  gateReason?: string;
  log?: ConsoleEntry[];
  trace?: TraceEntry[];
}

export interface ConsoleRun {
  status: string;
  mode: string;
  calls: number;
  writes?: number;
  debug?: boolean;
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const dur = (ms?: number) =>
  ms === undefined ? "" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

const tokens = (inTok?: number, outTok?: number) =>
  inTok === undefined && outTok === undefined
    ? ""
    : `${inTok ?? "?"}/${outTok ?? "?"} tok`;

/** Glue for the trailing `· 840ms · 512/64 tok` fragments. */
const meta = (...parts: string[]) => {
  const live = parts.filter(Boolean);
  return live.length ? ` · ${live.join(" · ")}` : "";
};

const STATUS_TEXT: Record<string, string> = {
  pending: "queued",
  running: "working",
  done: "finished",
  failed: "failed",
  needs_decision: "waiting on you",
};

/* ---------------------------------------------------------------------------
 * B — the tool-call console
 *
 * Flattens steps into one chronological list. The header of each step is its
 * own line, which is what makes the log readable when four steps interleave:
 * you always know whose tool call you are looking at.
 * ------------------------------------------------------------------------- */

type Row =
  | {
      kind: "header";
      stepId: string;
      position: number;
      title: string;
      status: string;
    }
  | { kind: "model" | "tool"; stepId: string; entry: ConsoleEntry }
  | { kind: "close"; stepId: string; status: string; gateReason?: string };

export function AgentConsole({
  steps,
  run,
  busy,
  onToggleDebug,
}: {
  steps: ConsoleStep[];
  run: ConsoleRun | null;
  busy: boolean;
  onToggleDebug: (enabled: boolean) => void;
}) {
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const step of steps) {
      out.push({
        kind: "header",
        stepId: step._id,
        position: step.position,
        title: step.title,
        status: step.status,
      });
      for (const entry of step.log ?? []) {
        out.push({ kind: entry.kind, stepId: step._id, entry });
      }
      if (step.status !== "pending" && step.status !== "running") {
        out.push({
          kind: "close",
          stepId: step._id,
          status: step.status,
          gateReason: step.gateReason,
        });
      }
    }
    return out;
  }, [steps]);

  // Follow the tail unless the reader has scrolled up to look at something —
  // a console that yanks the viewport back on every line is unreadable while
  // it is doing the one thing it exists to do.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  // The trace shows one step; default to the last one that has one, else the
  // last step — which is where you are looking when something goes odd.
  const [selected, setSelected] = useState<string | null>(null);
  const fallback =
    [...steps].reverse().find((s) => s.trace?.length) ??
    steps[steps.length - 1];
  const activeId =
    selected && steps.some((s) => s._id === selected)
      ? selected
      : (fallback?._id ?? null);
  const active = steps.find((s) => s._id === activeId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      {/* --- the log --- */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 pb-1.5">
          <Terminal className="size-3.5 text-primary" />
          <span className="hud-label" data-tone="cyan">
            Console
          </span>
          <span className="hud-readout text-[11px] text-muted-foreground/70">
            {rows.length} line{rows.length === 1 ? "" : "s"} · {run?.calls ?? 0}{" "}
            model calls
            {run?.mode === "auto" && run?.writes !== undefined
              ? ` · ${run.writes} writes`
              : ""}
          </span>
          <span className="hud-readout ml-auto text-[10px] text-muted-foreground/60">
            {run?.status ?? ""}
          </span>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-primary/20 bg-accent/25 px-2.5 py-2 font-mono text-[11px] leading-5"
        >
          {rows.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground/60">
              Nothing yet. Start a run and every model round and tool call
              lands here as it happens.
            </p>
          ) : (
            rows.map((row, i) => {
              if (row.kind === "header") {
                return (
                  <div
                    key={`h${i}`}
                    className={cn(
                      "mt-2 flex cursor-pointer items-baseline gap-2 rounded px-1 first:mt-0",
                      activeId === row.stepId
                        ? "bg-primary/10 text-foreground"
                        : "text-foreground/80",
                    )}
                    onClick={() => setSelected(row.stepId)}
                    title="Show this step's request/response"
                  >
                    <span className="text-primary">▸</span>
                    <span className="text-muted-foreground/60">
                      step {row.position + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  </div>
                );
              }
              if (row.kind === "close") {
                const tone =
                  row.status === "done"
                    ? "text-[var(--signal-green)]"
                    : row.status === "failed"
                      ? "text-destructive"
                      : "text-[var(--signal-amber)]";
                return (
                  <div
                    key={`c${i}`}
                    className={cn("px-1 pl-5", tone)}
                  >
                    {row.status === "done" ? "✓ " : row.status === "failed" ? "✗ " : "⏸ "}
                    {STATUS_TEXT[row.status] ?? row.status}
                    {row.gateReason ? ` — ${row.gateReason}` : ""}
                  </div>
                );
              }

              const { entry } = row;
              const at = clock(entry.at);
              if (row.kind === "model") {
                return (
                  <div key={`m${i}`} className="flex gap-2 px-1 pl-5">
                    <span className="shrink-0 text-muted-foreground/50">
                      {at}
                    </span>
                    <span className="shrink-0 text-[var(--signal-cyan)]">↻</span>
                    <span className="min-w-0 flex-1 break-all text-foreground/90">
                      {entry.label}
                      <span className="text-muted-foreground/70">
                        {meta(
                          entry.detail ?? "",
                          dur(entry.ms),
                          tokens(entry.promptTokens, entry.completionTokens),
                        )}
                      </span>
                    </span>
                  </div>
                );
              }
              return (
                <div key={`t${i}`} className="flex gap-2 px-1 pl-5">
                  <span className="shrink-0 text-muted-foreground/50">
                    {at}
                  </span>
                  <span className="shrink-0 text-[var(--signal-green)]">⚙</span>
                  <span className="min-w-0 flex-1 break-all">
                    <span className="text-foreground/90">{entry.label}</span>
                    <span className="text-muted-foreground/70">
                      {meta(entry.detail ?? "", dur(entry.ms))}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* --- D: the inspector beside it --- */}
      <TraceInspector
        steps={steps}
        active={active}
        busy={busy}
        debug={Boolean(run?.debug)}
        onToggleDebug={onToggleDebug}
        onSelect={setSelected}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * D — the request/response inspector.
 *
 * Recording is a run-level switch, but the reader is per step: you turn it on
 * because one step is behaving strangely, then read that step's rounds.
 * ------------------------------------------------------------------------- */

function TraceInspector({
  steps,
  active,
  busy,
  debug,
  onToggleDebug,
  onSelect,
}: {
  steps: ConsoleStep[];
  active: ConsoleStep | null;
  busy: boolean;
  debug: boolean;
  onToggleDebug: (enabled: boolean) => void;
  onSelect: (stepId: string) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const trace = active?.trace ?? [];

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      setCopied(null);
    }
  };

  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col lg:w-80">
      <div className="flex items-center gap-2 pb-1.5">
        <span className="hud-label" data-tone="blue">
          Request / response
        </span>
        <button
          type="button"
          onClick={() => onToggleDebug(!debug)}
          disabled={busy}
          title={
            debug
              ? "Stop recording request and response bodies"
              : "Record what is sent to the model and what it replies, for steps worked from now on"
          }
          className={cn(
            "ml-auto rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest transition-colors disabled:opacity-40",
            debug
              ? "border-[var(--signal-amber)]/50 bg-[var(--signal-amber)]/10 text-[var(--signal-amber)]"
              : "border-border/70 text-muted-foreground hover:text-foreground",
          )}
        >
          {debug ? "Recording" : "Record"}
        </button>
      </div>

      {steps.length > 0 ? (
        <select
          value={active?._id ?? ""}
          onChange={(e) => onSelect(e.target.value)}
          className="hud-focus mb-2 w-full rounded-md border border-border/70 bg-accent/25 px-2 py-1.5 text-xs text-foreground outline-none"
        >
          {steps.map((s) => (
            <option key={s._id} value={s._id}>
              #{s.position + 1} {s.title}
            </option>
          ))}
        </select>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-primary/20 bg-accent/25 px-2 py-2">
        {trace.length === 0 ? (
          <p className="px-1 py-4 text-[11px] leading-5 text-muted-foreground/70">
            {debug
              ? "No rounds recorded for this step yet — recording starts with the next model call."
              : "Recording is off, so nothing was stored. Turn it on and the next model call keeps its request and reply (each capped, so a run cannot balloon)."}
          </p>
        ) : (
          trace.map((t) => (
            <details key={t.round} className="group mb-1.5">
              <summary className="flex cursor-pointer list-none items-baseline gap-1.5 rounded px-1 py-0.5 font-mono text-[11px] hover:bg-primary/10">
                <span className="text-muted-foreground/50 group-open:opacity-60">
                  ▸
                </span>
                <span className="text-foreground/90">round {t.round}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
                  {t.engineId ?? t.model ?? "engine"}
                </span>
                <span className="shrink-0 text-muted-foreground/60">
                  {meta(
                    dur(t.ms),
                    tokens(t.promptTokens, t.completionTokens),
                  ).replace(/^ · /, "")}
                </span>
              </summary>

              <div className="mt-1 space-y-1.5 border-l border-border/60 pl-2">
                {t.toolCalls ? (
                  <p className="text-[11px] text-[var(--signal-cyan)]">
                    asked for: {t.toolCalls}
                  </p>
                ) : null}
                <TraceBlock
                  label="Request"
                  text={t.request ?? ""}
                  copyKey={`r${t.round}`}
                  copied={copied}
                  onCopy={copy}
                />
                <TraceBlock
                  label="Response"
                  text={t.response ?? ""}
                  copyKey={`s${t.round}`}
                  copied={copied}
                  onCopy={copy}
                />
              </div>
            </details>
          ))
        )}
      </div>
    </aside>
  );
}

function TraceBlock({
  label,
  text,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  if (!text) return null;
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="hud-label">{label}</span>
        <button
          type="button"
          onClick={() => void onCopy(text, copyKey)}
          className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Copy className="size-3" />
          {copied === copyKey ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-4 text-foreground/80">
        {text}
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * C — preview + code split.
 *
 * The preview is assembled in the browser, not executed on a server: the
 * workspace's own HTML, with its stylesheets and scripts inlined from the
 * workspace rather than fetched, then run in an iframe with `allow-scripts`
 * and no same-origin. That is as far as a static preview can honestly go —
 * a React/Vite project needs a build, and this app does not run one.
 *
 * The captured console is the point. A page that renders nothing and says why
 * is debuggable; one that silently fails is a screenshot.
 * ------------------------------------------------------------------------- */

export function WorkspacePreview({
  contents,
  viewing,
  onView,
}: {
  contents: { path: string; content: string }[];
  viewing: string | null;
  onView: (path: string | null) => void;
}) {
  const [nonce, setNonce] = useState(0);
  const [lines, setLines] = useState<
    { level: string; text: string; at: number }[]
  >([]);
  const built = useMemo(() => buildDoc(contents), [contents]);

  // Captured output from the sandboxed frame. Filtered by the marker so an
  // unrelated message from another source never lands in the log.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { __aero?: number; level?: string; args?: unknown[] };
      if (!data || data.__aero !== 1) return;
      setLines((cur) =>
        [
          ...cur,
          {
            level: data.level ?? "log",
            text: (data.args ?? []).map(String).join(" "),
            at: Date.now(),
          },
        ].slice(-200),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // A rebuilt document is a new page, so it gets a clean console. Adjusted
  // during render rather than in an effect: an effect would paint the stale
  // console once and then blank it, which is exactly the flicker this avoids.
  const [seenDoc, setSeenDoc] = useState<string | null>(null);
  const docNow = built.doc ?? null;
  if (seenDoc !== docNow) {
    setSeenDoc(docNow);
    setLines([]);
  }

  const file = contents.find((f) => f.path === viewing) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Files className="size-3.5 text-primary" />
        <span className="hud-label" data-tone="cyan">
          Preview
        </span>
        <span className="hud-readout text-[11px] text-muted-foreground/70">
          {contents.length} file{contents.length === 1 ? "" : "s"} in the
          workspace
        </span>
        <button
          type="button"
          onClick={() => {
            setNonce((n) => n + 1);
            setLines([]);
          }}
          disabled={!built.doc}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
        >
          <RotateCw className="size-3" />
          Reload
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
        {/* ---- files + code ---- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <ul className="max-h-32 space-y-px overflow-y-auto">
            {contents.length === 0 ? (
              <li className="py-2 text-[11px] text-muted-foreground/70">
                The workspace is empty.
              </li>
            ) : (
              contents.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => onView(f.path)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent",
                      viewing === f.path
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <FileCode className="size-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{f.path}</span>
                    <span className="hud-readout shrink-0 text-[10px] opacity-60">
                      {f.content.length < 1024
                        ? `${f.content.length}B`
                        : `${Math.round(f.content.length / 102.4) / 10}k`}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="hud-panel min-h-0 flex-1 overflow-hidden">
            {file ? (
              <>
                <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
                  <span className="hud-readout min-w-0 flex-1 truncate text-[11px]">
                    {file.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => onView(null)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="Close file"
                  >
                    ✕
                  </button>
                </div>
                <pre className="h-full max-h-full overflow-auto px-2 py-1.5 font-mono text-[10px] leading-4">
                  {file.content}
                </pre>
              </>
            ) : (
              <p className="px-2 py-4 text-[11px] text-muted-foreground/70">
                Pick a file to read it beside the preview.
              </p>
            )}
          </div>
        </section>

        {/* ---- the page, and its console ---- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-primary/20">
            {built.doc ? (
              <iframe
                key={nonce}
                title="Workspace preview"
                sandbox="allow-scripts"
                srcDoc={built.doc}
                // Pages assume a light canvas; a dark shell would render the
                // background of everything the agent writes.
                className="min-h-40 w-full flex-1 border-0 bg-white"
              />
            ) : (
              <div className="flex min-h-40 flex-1 items-center justify-center px-6 py-8 text-center">
                <p className="max-w-sm text-[11px] leading-5 text-muted-foreground/80">
                  {built.note}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-border/60 bg-background/70 px-2 py-1">
              <span className="hud-label">Page console</span>
              <span className="hud-readout text-[10px] text-muted-foreground/60">
                {lines.length}
              </span>
              {lines.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLines([])}
                  className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Trash2 className="size-3" />
                  Clear
                </button>
              ) : null}
            </div>
            <div className="h-28 overflow-y-auto bg-background/70 px-2 py-1 font-mono text-[10px] leading-4">
              {lines.length === 0 ? (
                <p className="text-muted-foreground/60">
                  console.log, warnings and errors from the page land here
                </p>
              ) : (
                lines.map((l, i) => (
                  <div
                    key={`${l.at}-${i}`}
                    className={cn(
                      "break-all",
                      l.level === "error"
                        ? "text-destructive"
                        : l.level === "warn"
                          ? "text-[var(--signal-amber)]"
                          : "text-muted-foreground",
                    )}
                  >
                    <span className="text-muted-foreground/40">
                      {clock(l.at)}{" "}
                    </span>
                    {l.level} › {l.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Assembling the page.
 *
 * The workspace is a folder of files, not a server, so the document is built
 * here: the entry HTML keeps its own structure, but every stylesheet and
 * script it references is inlined from the workspace when present. Relative
 * paths resolve against the HTML's own folder, which is how it would resolve
 * over HTTP too.
 * ------------------------------------------------------------------------- */

interface Built {
  doc?: string;
  note?: string;
}

/**
 * Intercepts the frame's console and window errors and forwards them to the
 * parent. Kept as one line of ES5 so it runs in whatever the generated page
 * targets, and free of `</script>` so it survives being embedded in one.
 */
const BRIDGE = `(function(){var send=function(level){return function(){try{var args=Array.prototype.slice.call(arguments).map(function(v){if(typeof v==="string")return v;try{return JSON.stringify(v)}catch(e){return String(v)}});parent.postMessage({__aero:1,level:level,args:args},"*")}catch(e){}}};["log","info","warn","error","debug"].forEach(function(k){var orig=console[k];console[k]=function(){send(k).apply(null,arguments);if(orig)orig.apply(console,arguments)}});window.onerror=function(m,src,line){parent.postMessage({__aero:1,level:"error",args:[m+" ("+(src||"inline")+":"+line+")"]},"*")};window.addEventListener("unhandledrejection",function(e){parent.postMessage({__aero:1,level:"error",args:["Unhandled rejection: "+String(e&&e.reason)]},"*")}})();`;

const injectBridge = (doc: string) =>
  /<\/head>/i.test(doc)
    ? doc.replace(/<\/head>/i, `<script>${BRIDGE}</script></head>`)
    : /<body[^>]*>/i.test(doc)
      ? doc.replace(
          /<body[^>]*>/i,
          (tag) => `${tag}<script>${BRIDGE}</script>`,
        )
      : `<script>${BRIDGE}</script>${doc}`;

/** Make inlined source safe to sit inside a tag of the same name. */
const escapeClosing = (source: string, tag: "script" | "style") =>
  source.replace(
    new RegExp(`</${tag}`, "gi"),
    `<\\/${tag}`,
  );

/** Resolve a relative reference the way an HTTP server would. */
function resolveRef(dir: string, ref: string): string | null {
  if (!ref || /^(https?:)?\/\//i.test(ref)) return null;
  if (/^(data|mailto|javascript):/i.test(ref)) return null;
  let clean = ref.split("#")[0].split("?")[0];
  try {
    clean = decodeURI(clean);
  } catch {
    /* a malformed escape keeps the raw text */
  }
  const parts = [...(dir ? dir.split("/") : []), ...clean.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function buildDoc(files: { path: string; content: string }[]): Built {
  if (files.length === 0) {
    return {
      note: "The workspace is empty — nothing to preview yet.",
    };
  }

  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const htmlPaths = files
    .filter((f) => f.path.endsWith(".html"))
    .map((f) => f.path)
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const entryHtml = htmlPaths.includes("index.html")
    ? "index.html"
    : htmlPaths[0];

  if (entryHtml) {
    const dir = entryHtml.includes("/")
      ? entryHtml.slice(0, entryHtml.lastIndexOf("/"))
      : "";
    let doc = byPath.get(entryHtml)!.content;

    // Stylesheets: inline the workspace's copy, leave an external link alone.
    doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']stylesheet["']/i.test(tag)) return tag;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      const resolved = href ? resolveRef(dir, href) : null;
      const file = resolved ? byPath.get(resolved) : undefined;
      return file
        ? `<style data-src="${resolved}">\n${escapeClosing(file.content, "style")}\n</style>`
        : tag;
    });

    // Scripts: same, keeping the tag's own attributes so `type="module"`
    // stays a module — an inlined module and an external one behave alike.
    doc = doc.replace(
      /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script\s*>/gi,
      (tag, pre: string, src: string, post: string) => {
        const resolved = resolveRef(dir, src);
        const file = resolved ? byPath.get(resolved) : undefined;
        return file
          ? `<script${pre}${post}>${escapeClosing(file.content, "script")}</script>`
          : tag;
      },
    );

    return { doc: injectBridge(doc) };
  }

  // No HTML: a script-only workspace can still be run, because the most
  // common shape of small generated work is DOM code with no page of its own.
  const candidates = ["index.js", "app.js", "main.js", "script.js"].filter(
    (p) => byPath.has(p),
  );
  const jsPaths = files
    .filter((f) => f.path.endsWith(".js") || f.path.endsWith(".mjs"))
    .map((f) => f.path);
  const entryJs = candidates[0] ?? jsPaths[0];

  if (entryJs) {
    const css = files
      .filter((f) => f.path.endsWith(".css"))
      .map((f) => escapeClosing(f.content, "style"))
      .join("\n");
    const source = escapeClosing(byPath.get(entryJs)!.content, "script");
    return {
      doc: injectBridge(
        `<!doctype html><html><head><meta charset="utf-8"><title>workspace</title><style>${css}</style></head><body></body><script>${source}</script></html>`,
      ),
    };
  }

  return {
    note: "Nothing web-runnable here — this workspace holds documents or programs rather than a page (look for index.html or a .js entry). The files are on the left.",
  };
}
