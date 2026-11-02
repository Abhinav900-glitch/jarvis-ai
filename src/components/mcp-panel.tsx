// ---------------------------------------------------------------------------
// MCP panel — Settings → MCP.
//
// The user's own MCP servers, plus the env-configured aggregator and Canva.
// From here the user can add a server (with its endpoint and auth), edit it,
// remove it, or test it — testing reaches the server, lists its tools, and
// stores the result so the chat can show how many tools each server offers.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  MCP_PRESETS,
  MCP_PRESET_CATEGORIES,
  presetAuthLabel,
  type McpPreset,
} from "@/lib/mcp-presets";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { McpServerRow, McpAuthType } from "../convex/mcpServers";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface McpRow extends McpServerRow {
  isEnvAggregator: boolean;
  isCanva: boolean;
}

function derivedFrom(row: McpServerRow): McpRow {
  return {
    ...row,
    isEnvAggregator: row._id === "mcp",
    isCanva: row._id === "canva",
  };
}

function readableAuth(row: McpRow): string {
  if (row.authType === "bearer") return "Bearer token";
  if (row.authType === "header") return `Custom header: ${row.authHeaderName ?? "Authorization"}`;
  if (row.isCanva) return "Canva OAuth";
  if (row.isEnvAggregator) return "Env key";
  return "None";
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface McpPanelProps {
  open: boolean;
  onClose: () => void;
}

export function McpPanel({ open, onClose }: McpPanelProps) {
  const rows = useQuery(api.mcpServers.list, open ? {} : "skip");
  const create = useMutation(api.mcpServers.create);
  const update = useMutation(api.mcpServers.update);
  const remove = useMutation(api.mcpServers.remove);
  const test = useAction(api.mcpServers.testConnection);
  const copyRedirect = useAction(api.canva.getOAuthStartUrl);

  const mapping = rows?.map(derivedFrom) ?? [];
  const owned = mapping.filter((r) => !r.isCanva && !r.isEnvAggregator);
  const env = mapping.filter((r) => r.isEnvAggregator);
  const canva = mapping.filter((r) => r.isCanva);

  // Add / edit form state
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [prefix, setPrefix] = useState("");
  const [authKind, setAuthKind] = useState<McpAuthType>("none");
  const [authValue, setAuthValue] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("Authorization");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<Id<"mcpServers"> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editingId = useRef<Id<"mcpServers"> | null>(null);

  // Reset the form whenever we switch modes (only the non-effect state; the
  // form fields above are the single source of truth, so clearing them here is
  // intentional and not "setState in an effect").
  const resetForm = useCallback(() => {
    setMode("list");
    setName("");
    setUrl("");
    setPrefix("");
    setAuthKind("none");
    setAuthValue("");
    setAuthHeaderName("Authorization");
    setSubmitting(false);
  }, []);

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

  // Focus the name field when entering add mode.
  useEffect(() => {
    if (mode === "add") {
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [mode]);

  const startAdd = () => {
    resetForm();
    setMode("add");
  };
  const cancel = () => resetForm();

  const populateEdit = useCallback((row: McpRow) => {
    editingId.current = row._id;
    setMode("edit");
    setName(row.name);
    setUrl(row.url);
    setPrefix(row.prefix ?? "");
    setAuthKind(row.authType ?? "none");
    setAuthValue(row.authValue ?? "");
    setAuthHeaderName(row.authHeaderName ?? "Authorization");
  }, []);

  const authHeaderNameValue = (): string | undefined => {
    if (authKind !== "header") return undefined;
    return authValue.trim() ? authHeaderName.trim() || "Authorization" : undefined;
  };

  const authValueFor = (): string | undefined => {
    if (authKind === "bearer" || authKind === "header") return authValue;
    return undefined;
  };

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    if (!url.trim()) {
      toast.error("Server URL is required.");
      return;
    }
    try {
      new URL(url.trim());
    } catch {
      toast.error("Server URL must be an https:// or http:// address.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "add") {
        const { created } = await create({
          name: name.trim(),
          url: url.trim(),
          prefix: prefix.trim() || undefined,
          authType: authKind,
          authValue: authValueFor(),
          authHeaderName: authHeaderNameValue(),
        });
        if (!created) {
          toast.info("That server is already in your list.");
        } else {
          toast.success("Server added.");
        }
      } else {
        const id = editingId.current;
        if (!id) return;
        await update({
          serverId: id,
          name: name.trim(),
          url: url.trim(),
          prefix: prefix.trim() || undefined,
          authType: authKind,
          authValue: authValueFor(),
          authHeaderName: authHeaderNameValue(),
        });
        toast.success("Server updated.");
      }
      cancel();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save that server.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (id: Id<"mcpServers">, label: string) => {
    if (!confirm(`Remove ${label} from your MCP servers?`)) return;
    try {
      await remove({ serverId: id });
      toast.success(`Removed ${label}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove that server.",
      );
    }
  };

  const handleTest = async (row: McpRow) => {
    setBusyId(row._id);
    try {
      const result = await test({ serverId: row._id });
      if (result.ok) {
        toast.success(
          result.toolCount != null
            ? `Reachable — ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"} listed.`
            : "Reachable — no tools exposed.",
        );
      } else {
        toast.error(result.lastError ?? "The server did not respond.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not reach that server.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleCopyRedirect = async () => {
    if (!canva.length) return;
    try {
      const { url } = await copyRedirect({ redirectUri: "https://freebuff.com/canva/callback" });
      await navigator.clipboard.writeText(url);
      toast.success("Canva redirect URI copied.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not copy the redirect URI.",
      );
    }
  };

  const envLine = env.length > 0 ? env[0] : null;

  // ---- preset catalogue ---------------------------------------------------
  const [presetQuery, setPresetQuery] = useState("");
  const [presetCategory, setPresetCategory] = useState("all");
  const [presetBusy, setPresetBusy] = useState<string | null>(null);
  // Open by default only when the list is empty: someone with servers of their
  // own wants those first, and the catalogue is one tap away.
  const [presetOpenPref, setPresetOpenPref] = useState<boolean | null>(null);
  const presetsOpen = presetOpenPref ?? owned.length === 0;

  const presets = useMemo(() => {
    const needle = presetQuery.trim().toLowerCase();
    return MCP_PRESETS.filter((preset) => {
      if (presetCategory !== "all" && preset.category !== presetCategory) {
        return false;
      }
      if (!needle) return true;
      return `${preset.name} ${preset.category} ${preset.note}`
        .toLowerCase()
        .includes(needle);
    });
  }, [presetQuery, presetCategory]);

  const ownedUrls = new Set(owned.map((row) => row.url.replace(/\/+$/, "")));
  const isPresetAdded = (preset: McpPreset) =>
    ownedUrls.has(preset.url.replace(/\/+$/, ""));

  /**
   * Open servers are created here and now. Keyed servers open the form with
   * the URL and auth kind already chosen, because only the user has the token.
   * OAuth servers cannot work without the provider's consent flow, so they say
   * so rather than failing at the first tool call.
   */
  const addPreset = async (preset: McpPreset) => {
    if (preset.auth === "oauth") {
      toast.info(`${preset.name} needs its own sign-in flow.`, {
        description:
          "This app does not run third-party OAuth for arbitrary servers. If you have an API token for it, add it manually with a custom header.",
      });
      return;
    }

    if (preset.auth === "none") {
      setPresetBusy(preset.id);
      try {
        const { created } = await create({
          name: preset.name,
          url: preset.url,
          prefix: preset.prefix,
          authType: "none",
        });
        if (created) {
          toast.success(`${preset.name} added.`, {
            description: "Run Test to list the tools it exposes.",
          });
        } else {
          toast.info(`${preset.name} is already in your list.`);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not add that server.",
        );
      } finally {
        setPresetBusy(null);
      }
      return;
    }

    resetForm();
    setName(preset.name);
    setUrl(preset.url);
    setPrefix(preset.prefix);
    setAuthKind(preset.auth === "header" ? "header" : "bearer");
    setAuthHeaderName(preset.headerName ?? "Authorization");
    setAuthValue("");
    setMode("add");
    toast.info(`${preset.name} needs your key.`, {
      description: "Paste it below and the server is ready to test.",
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm md:items-start md:justify-center"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl max-h-[84vh]"
          >
            {/* header */}
            <div className="shrink-0 flex items-center gap-2 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur-sm">
              <svg
                className="size-4 text-muted-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-2.25 2.25m0 0l-2.25 2.25M12 12l3.75-3.75M12 12l-3.75 3.75m3.75 3.75l-2.25 2.25m-9.75-6l9 0"
                />
              </svg>
              <div className="min-w-0">
                <h2 className="text-sm font-medium">MCP servers</h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  Servers whose tools Jarvis can call on your behalf.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* min-h-0 + overflow-y-auto is what makes the panel scroll: the
                outer box clips at 84vh, so without a flex child that is allowed
                to shrink, the server list and the add form were cut off with
                no way to reach them. */}
            <div className="min-h-0 flex-1 divide-y overflow-y-auto">
              {/* ---- ready-made servers ---- */}
              <div className="bg-muted/20 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPresetOpenPref(!presetsOpen)}
                  aria-expanded={presetsOpen}
                  className="flex w-full items-center gap-1.5 text-left"
                >
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Ready-made
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {MCP_PRESETS.length} servers
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground/60">
                    {presetsOpen ? "Hide" : "Show"}
                  </span>
                </button>

                {presetsOpen ? (
                  <>
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
                  <Input
                    value={presetQuery}
                    onChange={(e) => setPresetQuery(e.target.value)}
                    placeholder="Search servers by name or what they do"
                    className="h-8 pl-8 text-xs"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {["all", ...MCP_PRESET_CATEGORIES].map((category) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => setPresetCategory(category)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                        presetCategory === category
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {category === "all" ? "All" : category}
                    </button>
                  ))}
                </div>

                <ul className="mt-2 space-y-1">
                  {presets.length === 0 ? (
                    <li className="py-3 text-center text-[11px] text-muted-foreground/70">
                      Nothing matches that.
                    </li>
                  ) : (
                    presets.map((preset) => {
                      const added = isPresetAdded(preset);
                      return (
                        <li
                          key={preset.id}
                          className="flex items-start gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {preset.name}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-1 py-px text-[9px] uppercase tracking-wide",
                                  preset.auth === "none"
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : preset.auth === "oauth"
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-cyan-500/15 text-cyan-300",
                                )}
                              >
                                {presetAuthLabel(preset.auth)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                              {preset.note}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {preset.docs ? (
                              <a
                                href={preset.docs}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Provider docs"
                                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                              >
                                <ExternalLink className="size-3" />
                              </a>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant={
                                preset.auth === "none" ? "default" : "outline"
                              }
                              disabled={added || presetBusy === preset.id}
                              onClick={() => void addPreset(preset)}
                              title={
                                preset.auth === "oauth"
                                  ? "Needs the provider's own sign-in"
                                  : added
                                    ? "Already added"
                                    : `Add ${preset.name}`
                              }
                              className="h-6 gap-1 px-2 text-[10px]"
                            >
                              {presetBusy === preset.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : added ? (
                                <Check className="size-3" />
                              ) : (
                                <Plus className="size-3" />
                              )}
                              {added
                                ? "Added"
                                : preset.auth === "none"
                                  ? "Add"
                                  : preset.auth === "oauth"
                                    ? "Info"
                                    : "Add key"}
                            </Button>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
                  </>
                ) : null}
              </div>

              {/* ---- env aggregator (single, from Keys tab) ---- */}
              {envLine ? (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm">
                          {envLine.name || "Aggregator server"}
                        </span>
                        <span className="rounded bg-violet-500/15 px-1.5 py-px text-[9px] uppercase tracking-wide text-violet-300">
                          env
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {envLine.url}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        Auth: {readableAuth(envLine)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {envLine.lastTestedAt != null && envLine.toolCount != null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-px text-[10px] text-emerald-300">
                          <Check className="size-3" />
                          {envLine.toolCount} tool
                          {envLine.toolCount === 1 ? "" : "s"}
                        </span>
                      ) : envLine.lastError != null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-px text-[10px] text-rose-300">
                          <span className="size-3" />
                          {envLine.lastError.length > 60
                            ? envLine.lastError.slice(0, 60) + "…"
                            : envLine.lastError}
                        </span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleTest(envLine)}
                          disabled={busyId != null}
                          className="gap-1.5"
                        >
                          {busyId != null ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <ExternalLink className="size-3" />
                          )}
                          Test
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ---- Canva (special, from its own OAuth flow) ---- */}
              {canva.length > 0 ? (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-sm">
                          Canva (official MCP)
                        </span>
                        <span className="rounded bg-cyan-500/15 px-1.5 py-px text-[9px] uppercase tracking-wide text-cyan-300">
                          oauth
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        api.canva.com/connect/v1/mcp — uses your connected Canva
                        account
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                        Add the scopes your apps need in the Canva Developer
                        Portal, then reconnect.
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleCopyRedirect}
                        className="gap-1.5"
                      >
                        <Copy className="size-3" />
                        Copy redirect URI
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* ---- user-registered servers ---- */}
              {owned.length === 0 &&
                envLine == null &&
                canva.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="mx-auto mb-3 size-10 text-muted-foreground/50">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-2.25 2.25m0 0l-2.25 2.25M12 12l3.75-3.75M12 12l-3.75 3.75m3.75 3.75l-2.25 2.25m-9.75-6l9 0"
                      />
                    </svg>
                  </div>
                  <p className="text-sm text-foreground font-medium">
                    No MCP servers yet
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground/70">
                    Add a server below (or set MCP_SERVER_URL in the Keys tab for a
                    single aggregator key).
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {owned.map((row) => (
                    <li
                      key={row._id}
                      className={cn(
                        "px-4 py-3 transition-colors",
                        busyId === row._id ? "opacity-60" : "",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-sm">
                              {row.name}
                            </span>
                            <span className="rounded bg-cyan-500/15 px-1.5 py-px text-[9px] uppercase tracking-wide text-cyan-300">
                              {row.authType ?? "none"}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {row.url}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                            {row.prefix
                              ? `prefix: ${row.prefix}`
                              : "prefix: (same as name)"}
                            {" · "}
                            {readableAuth(row)}
                          </p>
                          {row.lastTestedAt != null ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                              {new Date(row.lastTestedAt).toLocaleString()}
                              {row.toolCount != null
                                ? ` · ${row.toolCount} tool${row.toolCount === 1 ? "" : "s"}`
                                : ""}
                              {row.lastError != null ? ` · ${row.lastError.slice(0, 80)}` : ""}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => populateEdit(row)}
                            title="Edit"
                            className="gap-1"
                          >
                            <svg
                              className="size-3.5"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              aria-hidden
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                              />
                            </svg>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleTest(row)}
                            disabled={busyId != null}
                            title="Test connection"
                            className="gap-1"
                          >
                            {busyId === row._id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ExternalLink className="size-3" />
                            )}
                            Test
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemove(row._id, row.name)}
                            title="Remove"
                            className="text-rose-400 hover:text-rose-500 hover:bg-rose-500/10"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* ---- add / edit form ---- */}
              {mode !== "list" ? (
                <div className="border-t px-4 py-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      {mode === "add" ? "Add an MCP server" : "Edit server"}
                    </p>
                    <button
                      type="button"
                      onClick={cancel}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Name
                      </label>
                      <Input
                        ref={nameRef}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. My Pipedream"
                        disabled={submitting}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Server URL
                      </label>
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://remote.mcp.pipedream.net/v3"
                        disabled={submitting}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Prefix (tool names)
                      </label>
                      <Input
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        placeholder={name || "my-server"}
                        disabled={submitting}
                        className="font-mono text-xs"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                        Tools become {name || "my-server"}__toolName. Leave blank to
                        derive from the name.
                      </p>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                        Auth
                      </label>
                      <Select
                        value={authKind}
                        onValueChange={(v) =>
                          setAuthKind(v as McpAuthType)
                        }
                        disabled={submitting}
                      >
                        <SelectTrigger className="text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            None (open server)
                          </SelectItem>
                          <SelectItem value="bearer">
                            Bearer token
                          </SelectItem>
                          <SelectItem value="header">
                            Custom header
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {authKind === "bearer" && (
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Bearer token
                        </label>
                        <Input
                          type="password"
                          value={authValue}
                          onChange={(e) => setAuthValue(e.target.value)}
                          placeholder="paste the token"
                          disabled={submitting}
                        />
                      </div>
                    )}

                    {authKind === "header" && (
                      <div className="space-y-2.5">
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Header name
                          </label>
                          <Input
                            value={authHeaderName}
                            onChange={(e) =>
                              setAuthHeaderName(e.target.value)
                            }
                            placeholder="Authorization"
                            disabled={submitting}
                            className="font-mono text-xs"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Header value
                          </label>
                          <Input
                            type="password"
                            value={authValue}
                            onChange={(e) => setAuthValue(e.target.value)}
                            placeholder="paste the value"
                            disabled={submitting}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={cancel}
                        disabled={submitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSave}
                        disabled={submitting}
                        className="gap-1.5"
                      >
                        {submitting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowRight className="size-3.5" />
                        )}
                        {mode === "add" ? "Add server" : "Save changes"}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* footer */}
            <div className="flex shrink-0 items-center gap-2 border-t px-4 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={startAdd}
                className="gap-1.5"
              >
                <Plus className="size-3.5" />
                Add MCP server
              </Button>
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                Tokens you enter are stored for your account only.
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
