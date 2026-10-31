// ---------------------------------------------------------------------------
// AeroTransformGen — the overview surface.
//
// Deliberately a different shape from AeroTransformGen Dev, on the same
// principle Claude uses for Code versus Chat: two surfaces over one concept.
// Dev is where you *drive* a run — type a goal, watch it work, approve an edit.
// This is where you *read* the estate — what has been run, what it changed,
// what it cost, and what is still sitting there undoable.
//
// The split matters because the two answer different questions. Dev is
// chronological and forward-looking; this one is a ledger. Mixing them is what
// makes an agent panel become a wall of scroll with no sense of state.
//
// It reads the same runs and the same workspace. A dashboard over duplicated
// tables would look plausible and be permanently empty, because nothing writes
// to them — so the "separate" here is the UI, not the storage.
// ---------------------------------------------------------------------------

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  Cpu,
  Files,
  FolderTree,
  Gauge,
  History,
  Loader2,
  Puzzle,
  Undo2,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { languageOf } from "@/lib/agent-tools";
import { cn } from "@/lib/utils";

export interface AeroTransformGenDashboardProps {
  open: boolean;
  onClose: () => void;
  /** Hands the selected run over to the Dev surface. */
  onOpenRun: (runId: Id<"agentRuns">) => void;
}

type Tab = "runs" | "workspace" | "embed";

const RUN_TONE: Record<string, string> = {
  planning: "bg-[var(--signal-blue)]",
  running: "bg-[var(--signal-cyan)]",
  awaiting_user: "bg-[var(--signal-amber)]",
  done: "bg-[var(--signal-green)]",
  failed: "bg-[var(--signal-rose)]",
  cancelled: "bg-muted-foreground/50",
};

const MODE_LABEL: Record<string, string> = {
  readonly: "read only",
  ask: "asked first",
  auto: "auto",
};

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102) / 10} kB`;
  return `${Math.round(n / 104_857.6) / 10} MB`;
}

// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="hud-panel px-2.5 py-2">
      <div className="hud-label">{label}</div>
      <div
        className={cn(
          "hud-readout mt-0.5 text-lg leading-none",
          tone ?? "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RunRow({
  run,
  onOpenRun,
}: {
  run: {
    _id: Id<"agentRuns">;
    title: string;
    goal: string;
    status: string;
    mode: string;
    planned: number;
    done: number;
    calls: number;
    answer?: string;
    error?: string;
    updatedAt: number;
  };
  onOpenRun: (id: Id<"agentRuns">) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = useQuery(
    api.agentStore.steps,
    open ? { runId: run._id } : "skip",
  );

  return (
    <li className="hud-panel">
      <div className="flex items-start gap-2 px-3 py-2">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            RUN_TONE[run.status] ?? "bg-muted-foreground/40",
          )}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
              {run.title}
            </span>
          </span>
          <span className="hud-readout mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-2.5" />
              {relativeTime(run.updatedAt)}
            </span>
            <span>
              {run.done}/{run.planned || "–"} steps
            </span>
            <span>{run.calls} calls</span>
            <span>{MODE_LABEL[run.mode] ?? run.mode}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpenRun(run._id)}
          title="Open in AeroTransformGen Dev"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 px-3 py-2">
              <p className="text-[11px] leading-5 text-muted-foreground">
                {run.goal}
              </p>

              {(steps ?? []).length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {(steps ?? []).map((s) => (
                    <li key={s._id} className="flex items-start gap-2">
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          s.status === "done"
                            ? "bg-[var(--signal-green)]"
                            : s.status === "failed"
                              ? "bg-[var(--signal-rose)]"
                              : s.status === "needs_decision"
                                ? "bg-[var(--signal-amber)]"
                                : "bg-muted-foreground/30",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] leading-4 text-foreground/90">
                          {s.title}
                        </span>
                        {s.engineId ? (
                          <span className="hud-readout text-[10px] text-muted-foreground/60">
                            {s.engineId}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {run.answer ? (
                <div className="mt-2 rounded border border-[var(--signal-green)]/20 bg-[var(--signal-green)]/5 px-2 py-1.5">
                  <span className="hud-label text-[var(--signal-green)]">
                    Result
                  </span>
                  <p className="mt-0.5 max-h-40 overflow-y-auto text-[11px] leading-5 whitespace-pre-wrap text-foreground/90">
                    {run.answer}
                  </p>
                </div>
              ) : null}

              {run.error ? (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-destructive">
                  <CircleAlert className="mt-px size-3 shrink-0" />
                  {run.error}
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

// ---------------------------------------------------------------------------

/**
 * The publishable plugin, now a builder: pick the label, corner and accent,
 * watch the button at true scale, copy the snippet those choices produce.
 *
 * Every choice maps one-for-one onto a loader data attribute, so a "custom
 * plugin" is just a customised snippet — no server round trip, nothing to
 * configure on the host page, and the copied tag carries the whole config.
 */
type EmbedConfig = {
  label: string;
  position: "right" | "left";
  accent: string;
};

const DEFAULT_EMBED: EmbedConfig = {
  label: "Ask Jarvis",
  position: "right",
  accent: "#22d3ee",
};

const ACCENT_SWATCHES = ["#22d3ee", "#34d399", "#f59e0b", "#f472b6"];

function loadEmbedConfig(): EmbedConfig {
  if (typeof window === "undefined") return DEFAULT_EMBED;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem("jarvis-embed-config") ?? "null",
    ) as Partial<EmbedConfig> | null;
    if (saved && typeof saved.label === "string") {
      return {
        label: saved.label.slice(0, 40),
        position: saved.position === "left" ? "left" : "right",
        // Six digits only: that is the form <input type="color"> produces and
        // reads back, so a stale three-digit value would desync the picker.
        accent:
          typeof saved.accent === "string" &&
          /^#[0-9a-fA-F]{6}$/.test(saved.accent)
            ? saved.accent
            : DEFAULT_EMBED.accent,
      };
    }
  } catch {
    /* corrupt or blocked storage: the defaults are fine */
  }
  return DEFAULT_EMBED;
}

function PluginCard() {
  const [config, setConfig] = useState<EmbedConfig>(loadEmbedConfig);
  const [copied, setCopied] = useState(false);
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-host";

  // Persisted so a tuned widget survives a reload; a browser that refuses
  // storage just makes the copied snippet the record of the choice.
  const update = (patch: Partial<EmbedConfig>) =>
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(
          "jarvis-embed-config",
          JSON.stringify(next),
        );
      } catch {
        /* private mode: ignore */
      }
      return next;
    });

  // The label lands in a script attribute on someone else's page, so quotes
  // and angle brackets are stripped before it can break their markup.
  const safeLabel =
    config.label.replace(/["<>&]/g, "").trim() || DEFAULT_EMBED.label;
  const snippet = `<script src="${origin}/jarvis-embed.js" async data-label="${safeLabel}" data-position="${config.position}" data-accent="${config.accent}"></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="hud-panel px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Puzzle className="size-4 text-primary" />
          <span className="hud-label" data-tone="cyan">
            Build your widget
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity"
          >
            {copied ? "Copied" : "Copy snippet"}
          </button>
        </div>

        {/* Knobs and a true-scale preview: the frame on the right renders the
            button exactly as jarvis-embed.js will paint it on the host. */}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-2.5">
            <label className="block">
              <span className="hud-label">Button text</span>
              <input
                type="text"
                value={config.label}
                maxLength={40}
                placeholder={DEFAULT_EMBED.label}
                onChange={(e) => update({ label: e.target.value })}
                className="mt-1 w-full rounded-md border border-border/70 bg-background/70 px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
              />
            </label>

            <div>
              <span className="hud-label">Corner</span>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border border-border/70">
                {(["right", "left"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => update({ position: side })}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest transition-colors",
                      config.position === side
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {side}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="hud-label">Accent</span>
              <div className="mt-1 flex items-center gap-1.5">
                {ACCENT_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    title={hex}
                    aria-label={`Use ${hex}`}
                    onClick={() => update({ accent: hex })}
                    className={cn(
                      "size-5 rounded-full border-2 transition-transform",
                      config.accent === hex
                        ? "scale-110 border-foreground"
                        : "border-border/60",
                    )}
                    style={{ background: hex }}
                  />
                ))}
                <input
                  type="color"
                  value={config.accent}
                  aria-label="Custom accent colour"
                  onChange={(e) => update({ accent: e.target.value })}
                  className="size-6 cursor-pointer rounded border border-border/70 bg-transparent p-0"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col rounded-lg border border-border/60 bg-background/70 p-3">
            <span className="hud-label text-muted-foreground/60">Preview</span>
            <div
              className={cn(
                "mt-2 flex flex-1 items-end py-3",
                config.position === "left" ? "justify-start" : "justify-end",
              )}
            >
              <span
                className="inline-flex items-center gap-2 rounded-full bg-[#04121f] px-4 py-2.5 text-[13px] font-semibold text-[#e6f6ff] shadow-md"
                style={{
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: config.accent,
                }}
              >
                <span
                  className="size-2 rounded-full"
                  style={{
                    background: config.accent,
                    boxShadow: `0 0 8px ${config.accent}`,
                  }}
                />
                {safeLabel}
              </span>
            </div>
          </div>
        </div>

        <pre className="mt-3 overflow-x-auto rounded border border-border/60 bg-background/70 px-3 py-2.5 font-mono text-[11px] leading-5 text-foreground/90">
          {snippet}
        </pre>
        <p className="mt-2.5 text-[11px] leading-5 text-muted-foreground/80">
          Paste it before <span className="font-mono">&lt;/body&gt;</span> on any
          site — your docs, a Canva-style app, a blog, a dashboard. The button
          appears in the corner and colour you picked above; clicking it opens
          this agent in a sandboxed frame where visitors sign in as usual. The
          host page never gets a handle on the frame: it runs on your origin
          with your auth, and the only thing it reports back is "ready" and
          "close".
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="hud-panel px-3 py-2.5">
          <span className="hud-label">data-label</span>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            The button's text.
          </p>
        </div>
        <div className="hud-panel px-3 py-2.5">
          <span className="hud-label">data-position</span>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            <span className="font-mono">left</span> flips the corner.
          </p>
        </div>
        <div className="hud-panel px-3 py-2.5">
          <span className="hud-label">data-accent</span>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Hex colour for the glow.
          </p>
        </div>
        <div className="hud-panel px-3 py-2.5">
          <span className="hud-label">JarvisEmbed.open()</span>
          <p className="mt-1 text-[11px] text-muted-foreground/80">
            Wire it to your own button.
          </p>
        </div>
      </div>

      <div className="hud-panel px-3 py-2.5">
        <p className="text-[11px] leading-5 text-muted-foreground/70">
          Also in this repo: <span className="font-mono">plugins/aerotransformgen</span>{" "}
          — a Claude Code plugin folder that teaches an assistant to install
          this widget in any project. Next rungs from there: serve{" "}
          <span className="font-mono">jarvis-embed.js</span> from a CDN, wrap
          the frame as a Chrome extension, or expose the agent as an MCP server
          so Claude and Cursor can drive it directly — same product, different
          host.
        </p>
      </div>
    </div>
  );
}

export function AeroTransformGenDashboard({
  open,
  onClose,
  onOpenRun,
}: AeroTransformGenDashboardProps) {
  const [tab, setTab] = useState<Tab>("runs");

  const runs = useQuery(api.agentStore.recent, { limit: 25 });
  const tree = useQuery(api.agentStore.workspaceTree, {});
  const checkpoints = useQuery(api.agentStore.checkpoints, { limit: 20 });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  const stats = useMemo(() => {
    const list = runs ?? [];
    return {
      total: list.length,
      done: list.filter((r) => r.status === "done").length,
      waiting: list.filter((r) => r.status === "awaiting_user").length,
      calls: list.reduce((sum, r) => sum + r.calls, 0),
    };
  }, [runs]);

  const workspace = useMemo(() => {
    const files = tree ?? [];
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    // Grouped by top-level directory, because a flat list of 40 paths is a list
    // nobody scans; "src/ (12 files)" is a thing you can act on.
    const groups = new Map<string, typeof files>();
    for (const f of files) {
      const key = f.path.includes("/")
        ? f.path.slice(0, f.path.indexOf("/"))
        : "";
      const bucket = groups.get(key);
      if (bucket) bucket.push(f);
      else groups.set(key, [f]);
    }
    return { count: files.length, bytes, groups };
  }, [tree]);

  if (!open) return null;

  const files = tree ?? [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020a14]/75 p-4 pt-[6vh] backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="hud-panel hud-corners flex max-h-[86vh] w-full max-w-4xl flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="AeroTransformGen"
        >
          {/* ---- header ---- */}
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Gauge className="size-4 text-primary" />
            <span className="hud-label" data-tone="cyan">
              AeroTransformGen
            </span>
            <span className="hud-label ml-1 text-muted-foreground/60">
              overview
            </span>

            <div className="ml-4 inline-flex overflow-hidden rounded-md border border-border/70">
              {(
                [
                  ["runs", "Runs", Activity],
                  ["workspace", "Workspace", FolderTree],
                  ["embed", "Plugin", Puzzle],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest transition-colors",
                    tab === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-3" />
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              title="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {tab === "embed" ? (
              <PluginCard />
            ) : tab === "runs" ? (
              <div className="space-y-4">
                {/* Cost is the headline here, not a footnote: every one of
                    these runs spent real free-tier requests, and this is the
                    only place that total is visible in one number. */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Runs" value={stats.total} />
                  <StatTile
                    label="Completed"
                    value={stats.done}
                    tone="text-[var(--signal-green)]"
                  />
                  <StatTile
                    label="Waiting on you"
                    value={stats.waiting}
                    tone={
                      stats.waiting > 0 ? "text-[var(--signal-amber)]" : undefined
                    }
                  />
                  <StatTile
                    label="Free calls spent"
                    value={stats.calls}
                    tone="text-primary"
                  />
                </div>

                {(runs ?? []).length === 0 ? (
                  <div className="hud-panel px-4 py-8 text-center">
                    <Bot className="mx-auto size-6 text-muted-foreground/50" />
                    <p className="mt-2 text-sm text-foreground">
                      No runs yet
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      Hand a task to AeroTransformGen Dev and it will show up
                      here with its steps, its result, and what it cost.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {(runs ?? []).map((run) => (
                      <RunRow
                        key={run._id}
                        run={run}
                        onOpenRun={(id) => {
                          onClose();
                          onOpenRun(id);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="min-w-0 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <StatTile label="Files" value={workspace.count} />
                    <StatTile label="Total size" value={humanBytes(workspace.bytes)} />
                    <StatTile
                      label="Undo points"
                      value={(checkpoints ?? []).length}
                      tone="text-[var(--signal-amber)]"
                    />
                  </div>

                  {files.length === 0 ? (
                    <div className="hud-panel px-4 py-8 text-center">
                      <Files className="mx-auto size-6 text-muted-foreground/50" />
                      <p className="mt-2 text-sm text-foreground">
                        Workspace is empty
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        Start a run in Dev — it seeds a README on the first one.
                      </p>
                    </div>
                  ) : (
                    [...workspace.groups.entries()]
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([dir, group]) => (
                        <div key={dir || "(root)"}>
                          <div className="flex items-center gap-1.5">
                            <FolderTree className="size-3 text-muted-foreground" />
                            <span className="hud-label">
                              {dir === "" ? "(root)" : dir}
                            </span>
                            <span className="hud-readout text-[10px] text-muted-foreground/60">
                              {group.length} file
                              {group.length === 1 ? "" : "s"} ·{" "}
                              {humanBytes(group.reduce((s, f) => s + f.size, 0))}
                            </span>
                          </div>
                          <ul className="mt-1 space-y-px">
                            {group.map((f) => {
                              const lang = languageOf(f.path);
                              const base = f.path.slice(
                                f.path.lastIndexOf("/") + 1,
                              );
                              return (
                                <li
                                  key={f.path}
                                  className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent"
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    <span className="text-foreground/90">
                                      {base}
                                    </span>
                                    <span className="text-muted-foreground/50">
                                      {" "}
                                      · {f.path}
                                    </span>
                                  </span>
                                  {lang ? (
                                    <span className="hud-label shrink-0">
                                      {lang}
                                    </span>
                                  ) : null}
                                  <span className="hud-readout w-14 shrink-0 text-right text-[10px] text-muted-foreground/60">
                                    {humanBytes(f.size)}
                                  </span>
                                  <span className="hud-readout w-14 shrink-0 text-right text-[10px] text-muted-foreground/50">
                                    {relativeTime(f.updatedAt)}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))
                  )}
                </div>

                {/* Checkpoints are listed rather than actionable here: undoing
                    is a decision made while driving a run, in Dev, where the
                    diff is in front of you. This is the receipt. */}
                <aside className="min-w-0 space-y-2 border-t border-border/60 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                  <div className="flex items-center gap-1.5">
                    <History className="size-3 text-muted-foreground" />
                    <span className="hud-label">Recent changes</span>
                  </div>
                  {(checkpoints ?? []).length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/70">
                      Nothing has been overwritten yet, so there is nothing to
                      undo.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {(checkpoints ?? []).map((c) => (
                        <li
                          key={c._id}
                          className="flex items-start gap-1.5 text-[11px]"
                        >
                          <Undo2 className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground/90">
                              {c.path}
                            </span>
                            <span className="hud-readout text-[10px] text-muted-foreground/60">
                              {c.existed
                                ? `${humanBytes(c.bytes)} restored`
                                : "did not exist"}
                              {" · "}
                              {relativeTime(c.createdAt)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground/60">
                    <Cpu className="mt-px size-3 shrink-0" />
                    Open Dev to rewind any of these.
                  </p>
                </aside>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2">
            <span className="hud-label text-muted-foreground/60">
              {tab === "embed"
                ? "One script tag and any site can run your agent"
                : tab === "runs"
                  ? "AeroTransformGen Dev runs the work · this reads it"
                  : "Workspace is shared with Dev"}
            </span>
            {tab === "runs" && stats.waiting > 0 ? (
              <span className="ml-auto inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin text-[var(--signal-amber)]" />
                <span className="hud-label text-[var(--signal-amber)]">
                  {stats.waiting} run{stats.waiting === 1 ? "" : "s"} need you
                </span>
              </span>
            ) : (
              <Check className="ml-auto size-3 text-[var(--signal-green)]" />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}