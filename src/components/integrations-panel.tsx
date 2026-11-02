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
} from "lucide-react";
import {
  MCP_PRESETS,
  MCP_PRESET_CATEGORIES,
  presetAuthLabel,
  type McpPreset,
} from "@/lib/mcp-presets";
import {
  BUILT_IN_INTEGRATIONS,
  type BuiltInIntegration,
  type IntegrationPanel,
} from "@/lib/integrations";
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
  return "border-sky-400/30 bg-sky-400/10 text-sky-300";
}

export function IntegrationsPanel({
  open,
  onClose,
  onOpenPanel,
}: IntegrationsPanelProps) {
  const rows = useQuery(api.mcpServers.list, open ? {} : "skip");
  const create = useMutation(api.mcpServers.create);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(12);
  const [keyTarget, setKeyTarget] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const [keyHeader, setKeyHeader] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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

              {/* ---- app directory ---- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <Blocks className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Accounts
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {connectedApps} of {MCP_PRESETS.length} connected
                  </span>
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
