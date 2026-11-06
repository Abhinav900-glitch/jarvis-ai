// ---------------------------------------------------------------------------
// Integrations panel — Settings → Integrations.
//
// One directory for everything the assistant can reach: the capabilities built
// into the app, and the third-party accounts that have a verified MCP endpoint.
// Connecting an open server happens right here; a server that needs a token
// asks for it inline, so the user never has to bounce to another screen.
// Removing or re-testing a connection still belongs to the MCP panel, which is
// one click away in the header.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight,
  Blocks,
  Brain,
  CalendarClock,
  Check,
  Code2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Loader2,
  Mic,
  Music,
  Palette,
  Plus,
  Puzzle,
  Radio,
  Search,
  Sigma,
  Sparkles,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  MCP_PRESETS,
  MCP_PRESET_CATEGORIES,
  POPULAR_PRESETS,
  presetAuthLabel,
  type McpPreset,
} from "@/lib/mcp-presets";
import {
  BUILT_IN_INTEGRATIONS,
  RECENT_FEATURES,
  type BuiltInIntegration,
  type IntegrationPanel,
} from "@/lib/integrations";
import {
  pluginSkillEntries,
  type PluginRow,
} from "@/lib/plugin-mentions";
import { api } from "@/convex/_generated/api";
import type { McpServerRow } from "../convex/mcpServers";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface IntegrationsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Route into the panel that owns a capability (Dashboard owns the toggles). */
  onOpenPanel: (panel: IntegrationPanel) => void;
}

const BUILT_IN_ICONS: Record<string, typeof Blocks> = {
  "voice-out": Mic,
  images: Wand2,
  "code-runner": Code2,
  memory: Brain,
  math: Sigma,
  translate: Languages,
  plugins: Puzzle,
  tasks: CalendarClock,
  sounds: Music,
  live: Radio,
  canva: Palette,
  cloudinary: ImageIcon,
};

/** Compare endpoints the way a person would: ignore a trailing slash and case. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

function authTone(auth: McpPreset["auth"]): string {
  if (auth === "none") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (auth === "oauth") return "border-border/70 bg-muted/40 text-muted-foreground";
  return "border-primary/30 bg-primary/10 text-primary";
}

export function IntegrationsPanel({
  open,
  onClose,
  onOpenPanel,
}: IntegrationsPanelProps) {
  const rows = useQuery(api.mcpServers.list, open ? {} : "skip");
  const pluginRows = useQuery(api.plugins.list, open ? {} : "skip");
  const create = useMutation(api.mcpServers.create);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(12);
  const [keyTarget, setKeyTarget] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyHeader, setKeyHeader] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [allFeatures, setAllFeatures] = useState(false);

  const mapping = useMemo<McpServerRow[]>(() => rows ?? [], [rows]);

  const connectionFor = (preset: McpPreset) =>
    mapping.find((row) => normalizeUrl(row.url) === normalizeUrl(preset.url));

  const isConnected = (preset: McpPreset) => connectionFor(preset) !== undefined;

  const canvaLinked = mapping.some((row) => row._id === "canva");
  const cloudinaryLinked = mapping.some((row) => row._id === "mcp");

  const builtInLive = (item: BuiltInIntegration): boolean => {
    if (item.id === "canva") return canvaLinked;
    if (item.id === "cloudinary") return cloudinaryLinked;
    return item.defaultOn;
  };

  const connectedApps = MCP_PRESETS.filter(isConnected).length;
  const openNow = MCP_PRESETS.filter((p) => p.auth === "none").length;

  /**
   * Connected connectors, shown as skills in their own right: each one hands the
   * assistant the tools it exposes, addressed by its `$prefix`. Only connectors
   * that are actually connected appear — an unconnected preset adds nothing to
   * a turn, and listing it here would imply it does.
   */
  const connectorSkills = useMemo(
    () =>
      MCP_PRESETS.filter(isConnected).map((preset) => {
        const connection = connectionFor(preset);
        return {
          id: preset.id,
          name: preset.name,
          prefix: preset.prefix,
          tools: connection?.toolCount ?? null,
        };
      }),
    // connectionFor is derived from mapping, so the rows are the real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapping],
  );

  const freshCount = RECENT_FEATURES.filter((feature) => feature.fresh).length;

  /**
   * The newest features by default, the whole inventory once expanded.
   *
   * Thirty cards inside an 84vh dialog would bury the sections below them, so
   * the list opens short and the rest is one click away — the section is still a
   * complete map of the build, just not all at once.
   */
  const visibleFeatures = allFeatures
    ? RECENT_FEATURES
    : RECENT_FEATURES.filter((feature) => feature.fresh);

  /** Skill files inside the user's enabled plugin zips, addressed as `@plugin/skill`. */
  const pluginSkills = useMemo(
    () => pluginSkillEntries((pluginRows ?? []) as unknown as PluginRow[]),
    [pluginRows],
  );

  // Closing resets the inline key form, so reopening the panel never shows a
  // half-typed token for a service the user walked away from.
  const close = useCallback(() => {
    setKeyTarget(null);
    setKeyValue("");
    setKeyHeader("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  const presets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MCP_PRESETS.filter((preset) => {
      if (category !== "all" && preset.category !== category) return false;
      if (!needle) return true;
      return (
        preset.name.toLowerCase().includes(needle) ||
        preset.note.toLowerCase().includes(needle) ||
        preset.category.toLowerCase().includes(needle) ||
        preset.id.toLowerCase().includes(needle)
      );
    });
  }, [query, category]);

  const visible = presets.slice(0, limit);

  const connect = async (preset: McpPreset) => {
    if (isConnected(preset)) return;

    if (preset.auth === "oauth") {
      toast.info(`${preset.name} needs its own sign-in.`, {
        description:
          "This app does not run third-party OAuth for arbitrary services. Open the docs to see whether it also issues an API token you can paste here.",
      });
      return;
    }

    if (preset.auth === "none") {
      setBusyId(preset.id);
      try {
        const { created } = await create({
          name: preset.name,
          url: preset.url,
          prefix: preset.prefix,
          authType: "none",
        });
        if (created) {
          toast.success(`${preset.name} connected.`, {
            description: "Its tools show up in the next message you send.",
          });
        } else {
          toast.info(`${preset.name} is already connected.`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not connect that service.",
        );
      } finally {
        setBusyId(null);
      }
      return;
    }

    setKeyTarget(preset.id);
    setKeyValue("");
    setKeyHeader(preset.headerName ?? "");
  };

  const submitKey = async (preset: McpPreset) => {
    const value = keyValue.trim();
    if (!value) {
      toast.error("Paste the key first.");
      return;
    }
    setBusyId(preset.id);
    try {
      const { created } = await create({
        name: preset.name,
        url: preset.url,
        prefix: preset.prefix,
        authType: preset.auth === "header" ? "header" : "bearer",
        authValue: value,
        authHeaderName:
          preset.auth === "header"
            ? keyHeader.trim() || preset.headerName || "Authorization"
            : undefined,
      });
      if (created) {
        toast.success(`${preset.name} connected.`, {
          description: "Open MCP servers to run a test and list its tools.",
        });
        setKeyTarget(null);
        setKeyValue("");
      } else {
        toast.info(`${preset.name} is already connected.`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save that key.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const openPanel = (panel: IntegrationPanel) => {
    close();
    onOpenPanel(panel);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm md:items-start md:justify-center"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
          >
            {/* header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-sm">
              <Blocks className="size-4 text-primary" />
              <div className="min-w-0">
                <h2 className="text-sm font-medium">Integrations</h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  Everything Jarvis can reach, and what is already live.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-[11px] text-muted-foreground"
                onClick={() => openPanel("mcp")}
              >
                Manage
                <ArrowUpRight className="ml-1 size-3" />
              </Button>
              <button
                type="button"
                onClick={close}
                className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* min-h-0 + overflow-y-auto keeps the 84vh box scrollable instead
                of clipping the directory. */}
            <div className="min-h-0 flex-1 divide-y overflow-y-auto">
              {/* ---- summary ---- */}
              <div className="grid grid-cols-3 divide-x divide-border/60 bg-muted/20">
                {[
                  { label: "Connected", value: connectedApps },
                  { label: "One-click", value: openNow },
                  { label: "Catalogue", value: MCP_PRESETS.length },
                ].map((stat) => (
                  <div key={stat.label} className="px-4 py-3">
                    <p className="font-mono text-lg leading-none">{stat.value}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>

              {/* ---- new features ---- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    New features
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {freshCount} new · {RECENT_FEATURES.length} in this build
                  </span>
                  <button
                    type="button"
                    onClick={() => setAllFeatures((v) => !v)}
                    className="ml-auto rounded-md border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {allFeatures ? "Show newest" : `Show all ${RECENT_FEATURES.length}`}
                  </button>
                </div>

                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {visibleFeatures.map((feature) => (
                    <li key={feature.id}>
                      <button
                        type="button"
                        disabled={feature.panel === undefined}
                        onClick={() => {
                          if (feature.panel) openPanel(feature.panel);
                        }}
                        className={cn(
                          "group flex h-full w-full flex-col items-start gap-1 rounded-lg border border-border/60 bg-card/40 p-2 text-left transition-colors",
                          feature.panel
                            ? "hover:border-primary/40 hover:bg-accent/40"
                            : "cursor-default",
                        )}
                      >
                        <span className="flex w-full items-center gap-1.5">
                          <span className="truncate text-xs font-medium">
                            {feature.name}
                          </span>
                          {feature.fresh ? (
                            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/15 px-1.5 py-px text-[9px] uppercase leading-4 tracking-wider text-primary">
                              new
                            </span>
                          ) : null}
                          {feature.panel ? (
                            <ArrowUpRight className="ml-auto size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                          ) : null}
                        </span>
                        <span className="line-clamp-2 block text-[10px] leading-4 text-muted-foreground/70">
                          {feature.blurb}
                        </span>
                        <span className="mt-auto block truncate text-[9px] uppercase tracking-wider text-muted-foreground/50">
                          {feature.where}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ---- built in ---- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Built in
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {BUILT_IN_INTEGRATIONS.length} capabilities
                  </span>
                </div>

                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {BUILT_IN_INTEGRATIONS.map((item) => {
                    const Icon = BUILT_IN_ICONS[item.id] ?? Blocks;
                    const live = builtInLive(item);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openPanel(item.panel)}
                        className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                      >
                        <span className="mt-0.5 rounded-md border border-border/60 bg-background/60 p-1.5 text-muted-foreground transition-colors group-hover:text-primary">
                          <Icon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium">
                              {item.name}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full border px-1.5 py-px text-[9px] leading-4",
                                live
                                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                  : "border-amber-400/30 bg-amber-400/10 text-amber-300",
                              )}
                            >
                              {live ? "live" : "link account"}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[10px] leading-4 text-muted-foreground/70">
                            {item.blurb}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/50">
                            {item.gain}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ---- connectors ---- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Blocks className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Connectors
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {connectedApps} of {MCP_PRESETS.length} connected
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={() => openPanel("mcp")}
                  >
                    MCP servers
                    <ArrowUpRight className="ml-1 size-3" />
                  </Button>
                </div>

                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
                  <Input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(12);
                    }}
                    placeholder="Search integrations by name or what they do"
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {["all", ...MCP_PRESET_CATEGORIES].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setCategory(c);
                        setLimit(12);
                      }}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        category === c
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {c === "all" ? "All" : c}
                    </button>
                  ))}
                </div>

                {POPULAR_PRESETS.some((preset) => !isConnected(preset)) ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {POPULAR_PRESETS.map((preset) => {
                      const connected = isConnected(preset);
                      const busy = busyId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={connected || busy}
                          title={
                            preset.auth === "oauth"
                              ? `${preset.note} Sign-in happens on ${preset.name}'s own site.`
                              : preset.note
                          }
                          onClick={() => {
                            // The app can only complete the flows it runs itself:
                            // open and token servers connect from here. An OAuth
                            // server needs the vendor's consent screen, so the
                            // pill narrows the list to that row instead of
                            // pretending a click connected it.
                            if (preset.auth === "oauth") {
                              setCategory("all");
                              setQuery(preset.name);
                              setLimit(12);
                              return;
                            }
                            void connect(preset);
                          }}
                          className={cn(
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                            connected
                              ? "cursor-default border-primary/30 bg-primary/10 text-primary/80"
                              : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground",
                          )}
                        >
                          {busy ? (
                            <Loader2 className="size-2.5 animate-spin" />
                          ) : connected ? (
                            <Check className="size-2.5" />
                          ) : null}
                          {preset.name}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <ul className="mt-2 space-y-1">
                  {visible.length === 0 ? (
                    <li className="py-3 text-center text-[11px] text-muted-foreground/70">
                      Nothing matches that.
                    </li>
                  ) : (
                    visible.map((preset) => {
                      const connection = connectionFor(preset);
                      const connected = connection !== undefined;
                      const busy = busyId === preset.id;
                      const editingKey = keyTarget === preset.id;
                      return (
                        <li
                          key={preset.id}
                          className="rounded-lg border border-transparent px-1 py-1 transition-colors hover:border-border/60 hover:bg-accent/30"
                        >
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium">
                                  {preset.name}
                                </span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full border px-1.5 py-px text-[9px] leading-4",
                                    authTone(preset.auth),
                                  )}
                                >
                                  {presetAuthLabel(preset.auth)}
                                </span>
                                {connected ? (
                                  <Check className="size-3 shrink-0 text-emerald-400" />
                                ) : null}
                              </div>
                              <p className="line-clamp-1 text-[10px] leading-4 text-muted-foreground/70">
                                {preset.note}
                                {connection && connection.toolCount != null
                                  ? ` · ${connection.toolCount} tools`
                                  : ""}
                              </p>
                            </div>

                            <span className="hidden shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/40 sm:block">
                              {preset.category}
                            </span>

                            {preset.docs ? (
                              <a
                                href={preset.docs}
                                target="_blank"
                                rel="noreferrer"
                                title="Provider setup docs"
                                className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
                              >
                                <ExternalLink className="size-3.5" />
                              </a>
                            ) : null}

                            {connected ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled
                                className="h-7 gap-1 px-2 text-[10px] text-emerald-300"
                              >
                                <Check className="size-3" />
                                Connected
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 px-2 text-[10px]"
                                disabled={busy}
                                onClick={() => void connect(preset)}
                              >
                                {busy ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : preset.auth === "oauth" ? (
                                  <ExternalLink className="size-3" />
                                ) : preset.auth === "none" ? (
                                  <Plus className="size-3" />
                                ) : (
                                  <KeyRound className="size-3" />
                                )}
                                {preset.auth === "oauth"
                                  ? "Info"
                                  : preset.auth === "none"
                                    ? "Connect"
                                    : "Add key"}
                              </Button>
                            )}
                          </div>

                          {editingKey ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 p-1.5">
                              {preset.auth === "header" ? (
                                <Input
                                  value={keyHeader}
                                  onChange={(e) => setKeyHeader(e.target.value)}
                                  placeholder={preset.headerName ?? "Header name"}
                                  className="h-7 w-40 font-mono text-[11px]"
                                />
                              ) : null}
                              <Input
                                value={keyValue}
                                onChange={(e) => setKeyValue(e.target.value)}
                                placeholder={
                                  preset.auth === "header"
                                    ? `${preset.headerName ?? "Header"} value`
                                    : "Paste your token"
                                }
                                type="password"
                                autoFocus
                                className="h-7 min-w-0 flex-1 text-[11px]"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void submitKey(preset);
                                }}
                              />
                              <Button
                                size="sm"
                                className="h-7 px-2 text-[10px]"
                                disabled={busy}
                                onClick={() => void submitKey(preset)}
                              >
                                {busy ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <KeyRound className="size-3" />
                                )}
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[10px]"
                                onClick={() => {
                                  setKeyTarget(null);
                                  setKeyValue("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                </ul>

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/60">
                    {visible.length} of {presets.length}
                  </span>
                  {visible.length < presets.length ? (
                    <button
                      type="button"
                      onClick={() => setLimit(limit + 24)}
                      className="ml-auto rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent"
                    >
                      Show 24 more
                    </button>
                  ) : null}
                </div>

                <p className="mt-2 text-[10px] leading-4 text-muted-foreground/60">
                  Connected accounts are called from the server, so their tools
                  run on your behalf. Services that only do OAuth are shown with
                  a docs link: this app runs no third-party sign-in flow.
                </p>
              </div>

              {/* ---- skills ---- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Puzzle className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Skills
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {connectorSkills.length + pluginSkills.length} available
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-[10px] text-muted-foreground"
                    onClick={() => openPanel("plugins")}
                  >
                    Manage skills
                    <ArrowUpRight className="ml-1 size-3" />
                  </Button>
                </div>

                <p className="mt-1 text-[10px] leading-4 text-muted-foreground/60">
                  A skill is anything the assistant can apply to a turn. A
                  connector contributes the tools it exposes; a plugin contributes
                  the Markdown skills inside its zip. Both are listed here.
                </p>

                {/* connector skills */}
                <div className="mt-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
                    <Blocks className="size-3" />
                    From connectors
                    <span className="text-muted-foreground/40">
                      {connectorSkills.length}
                    </span>
                  </div>

                  {connectorSkills.length === 0 ? (
                    <p className="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-2 text-[10px] leading-4 text-muted-foreground/60">
                      No connector skills yet — connect an account above and its
                      tools become callable from the next message you send.
                    </p>
                  ) : (
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {connectorSkills.map((skill) => (
                        <li
                          key={skill.id}
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5"
                        >
                          <Blocks className="size-3.5 shrink-0 text-primary/80" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs">
                              {skill.name}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground/60">
                              ${skill.prefix}
                              {skill.tools != null ? ` · ${skill.tools} tools` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-px text-[9px] leading-4 text-emerald-300">
                            live
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* plugin skills */}
                <div className="mt-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
                    <FileText className="size-3" />
                    From plugins
                    <span className="text-muted-foreground/40">
                      {pluginSkills.length}
                    </span>
                  </div>

                  {pluginSkills.length === 0 ? (
                    <p className="mt-1 rounded-lg border border-dashed border-border/60 px-2 py-2 text-[10px] leading-4 text-muted-foreground/60">
                      No plugin skills yet — upload a plugin zip and each Markdown
                      skill inside it becomes mentionable in the composer by typing
                      @ followed by the plugin name.
                    </p>
                  ) : (
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {pluginSkills.map((skill) => (
                        <li
                          key={`${skill.pluginId}:${skill.skillName}`}
                          className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs">
                              {skill.label}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground/60">
                              {skill.token}
                            </span>
                          </span>
                          <span className="max-w-[45%] shrink-0 truncate text-[9px] uppercase tracking-wider text-muted-foreground/50">
                            {skill.pluginName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
