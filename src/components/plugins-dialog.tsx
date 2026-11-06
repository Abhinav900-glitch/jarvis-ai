import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import type { GenericId } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertTriangle,
  Archive,
  Check,
  Cpu,
  Download,
  FileText,
  Loader2,
  Package,
  Plus,
  Puzzle,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { inspectZip } from "@/lib/zip-inspect";
import {
  buildPresetZip,
  PLUGIN_CATEGORIES,
  PLUGIN_PRESETS,
  type PluginPreset,
} from "@/lib/plugin-presets";

/** Mirrors the server cap, so a doomed upload is refused before it starts. */
const MAX_ZIP_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One entry of the manifest list stored on a plugin row. */
interface StoredManifest {
  path?: string;
  kind?: string;
  name?: string;
}

function parseManifests(manifests: string | undefined): StoredManifest[] {
  if (!manifests) return [];
  try {
    const parsed = JSON.parse(manifests) as StoredManifest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Names recorded inside the zip at upload time, for the row's summary line. */
function manifestNames(manifests: string | undefined): string[] {
  return parseManifests(manifests)
    .filter((m) => m.kind !== "skill")
    .map((m) => m.name)
    .filter((n): n is string => Boolean(n));
}

/**
 * Skill files recorded alongside the manifests (`skills/*.md`). Keeping their
 * exact paths is what lets the skill button open the right entry — a zip can
 * hold several skills, and only the path identifies one.
 */
function skillPaths(manifests: string | undefined): string[] {
  return parseManifests(manifests)
    .filter((m) => m.kind === "skill")
    .map((m) => m.path ?? m.name)
    .filter((n): n is string => Boolean(n));
}

/**
 * Settings → Plugins: the account's zip archive.
 *
 * A zip is inspected before it is stored — which plugin folders and MCP
 * configs it holds — because "we have your file" is only trustworthy when the
 * screen can say what is in it. The file itself is kept byte-for-byte in
 * Convex storage: nothing is executed, unpacked into the workspace, or sent
 * anywhere else from here.
 */
export function PluginsDialog({
  open,
  onClose,
  onOpenSkill,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen skill when the user picks one from a stored plugin. */
  onOpenSkill?: (pluginId: Id<"plugins">, skillName: string) => void;
}) {
  const plugins = useQuery(api.plugins.list, open ? {} : "skip");
  const uploadUrl = useMutation(api.plugins.uploadUrl);
  const save = useMutation(api.plugins.save);
  const setEnabled = useMutation(api.plugins.setEnabled);
  const remove = useMutation(api.plugins.remove);
  // Model plugins: engines a provider ships installed-but-off, switched
  // per account so an enable here changes what the router may reach.
  const modelPlugins = useQuery(api.plugins.modelPlugins, open ? {} : "skip");
  const setModelPluginEnabled = useMutation(api.plugins.setModelPluginEnabled);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<
    GenericId<"plugins"> | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- built-in pack picker ----------------------------------------------
  // The catalogue is large on purpose, so the picker searches and pages rather
  // than rendering all of it: eight rows at first, more on request.
  const [presetQuery, setPresetQuery] = useState("");
  const [presetCategory, setPresetCategory] = useState("all");
  const [presetLimit, setPresetLimit] = useState(8);

  const filteredPresets = useMemo(() => {
    const needle = presetQuery.trim().toLowerCase();
    return PLUGIN_PRESETS.filter((preset) => {
      if (presetCategory !== "all" && preset.category !== presetCategory) {
        return false;
      }
      if (!needle) return true;
      return `${preset.name} ${preset.category} ${preset.tagline} ${preset.id}`
        .toLowerCase()
        .includes(needle);
    });
  }, [presetQuery, presetCategory]);

  const visiblePresets = filteredPresets.slice(0, presetLimit);

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

  const toggleModelPlugin = async (slug: string, next: boolean) => {
    try {
      await setModelPluginEnabled({ slug, enabled: next });
      toast.success(
        next
          ? "Plugin switched on — the router can use it in chat."
          : "Plugin switched off — installed, but not used in AI chat.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not switch that plugin.",
      );
    }
  };

  const store = async (file: File) => {
    setError(null);
    if (!/\.zip$/i.test(file.name)) {
      setError("That is not a .zip file.");
      return;
    }
    if (file.size === 0) {
      setError("That file is empty.");
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      setError("That zip is over 25 MB — trim it and try again.");
      return;
    }

    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      // Throws with a readable message when the file is not a zip at all.
      const info = await inspectZip(buffer);

      const pluginManifest = info.manifests.find((m) => m.kind === "plugin");
      const primary = pluginManifest ?? info.manifests[0];
      const holdsMcp = info.manifests.some((m) => m.kind === "mcp");

      const url = await uploadUrl({});
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!response.ok) {
        throw new Error("The upload was refused — try the file again.");
      }
      const { storageId } = (await response.json()) as {
        storageId: GenericId<"_storage">;
      };

      // Skill files are recorded next to the manifests so the row can offer
      // each one by its real path. Without this, a zip with three skills only
      // exposed its plugin name, which is not a file that exists.
      const skills = info.entries
        .filter((name) => /(^|\/)skills\/[^/]+\.md$/i.test(name))
        .slice(0, 25)
        .map((name) => ({ path: name, kind: "skill" as const, name }));

      await save({
        fileName: file.name,
        storageId,
        name: primary?.name ?? file.name.replace(/\.zip$/i, ""),
        kind: pluginManifest ? "plugin" : holdsMcp ? "mcp" : "plugin",
        version: primary?.version,
        description: primary?.description,
        sizeBytes: file.size,
        fileCount: info.entries.length,
        manifests: JSON.stringify([...info.manifests, ...skills]),
      });

      if (info.manifests.length === 0) {
        toast.info(`Stored ${file.name}`, {
          description:
            "No plugin.json or .mcp.json inside — kept as-is, so it can still be downloaded.",
        });
      } else {
        toast.success(`Stored ${file.name}`, {
          description: info.manifests
            .map((m) => `${m.name} (${m.kind})`)
            .join(", "),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not store that zip.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = (pluginId: GenericId<"plugins">) => {
    // Two clicks: the first names the row, the second removes it. A zip that
    // took someone a while to assemble deserves more than one stray tap.
    if (confirmingId !== pluginId) {
      setConfirmingId(pluginId);
      return;
    }
    setConfirmingId(null);
    void remove({ pluginId }).catch(() => {
      toast.error("Could not remove that zip.");
    });
  };

  /** Build a built-in pack and send it through the same store path as a file. */
  const addPreset = async (preset: PluginPreset) => {
    const blob = buildPresetZip(preset);
    const file = new File([blob], `${preset.id}.zip`, {
      type: "application/zip",
    });
    await store(file);
  };

  /** Keep a copy of a built-in pack on disk, without adding it to the archive. */
  const downloadPreset = (preset: PluginPreset) => {
    const url = URL.createObjectURL(buildPresetZip(preset));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${preset.id}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-0 backdrop-blur-sm sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="hud-panel hud-corners flex h-full max-h-none w-full max-w-none flex-col pt-[env(safe-area-inset-top)] sm:h-auto sm:max-h-[84vh] sm:max-w-2xl sm:rounded-2xl sm:pt-0"
        role="dialog"
        aria-modal="true"
        aria-label="Plugins"
      >
        {/* ---- header ---- */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
          <Puzzle className="size-4 text-primary" />
          <span className="hud-label" data-tone="cyan">
            Plugins &amp; MCP
          </span>
          <span className="hud-label ml-1 text-muted-foreground/60">
            stored zips
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {/* ---- built-in packs ---- */}
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
            <div className="flex items-center gap-1.5">
              <Package className="size-3.5 text-primary" />
              <span className="hud-label" data-tone="cyan">
                Ready-made packs
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                built in · {PLUGIN_PRESETS.length}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground/70">
              Skills written as Markdown, one shelf per discipline. Add a pack to
              your archive, or download the zip and keep it.
            </p>

            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground/60" />
              <input
                value={presetQuery}
                onChange={(e) => {
                  setPresetQuery(e.target.value);
                  setPresetLimit(8);
                }}
                placeholder="Search packs by name, shelf or scope"
                aria-label="Search built-in packs"
                className="h-8 w-full rounded-md border border-border/70 bg-background pl-8 pr-3 text-xs outline-none transition-colors focus:border-primary/50"
              />
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {["all", ...PLUGIN_CATEGORIES].map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setPresetCategory(category);
                    setPresetLimit(8);
                  }}
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

            <ul className="mt-2 space-y-1.5">
              {visiblePresets.length === 0 ? (
                <li className="py-4 text-center text-[11px] text-muted-foreground/70">
                  Nothing matches that. Try a shelf name or a simpler word.
                </li>
              ) : (
                visiblePresets.map((preset) => (
                  <li
                    key={preset.id}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {preset.name}
                        </span>
                        <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                          {preset.category}
                        </span>
                        {preset.skills.length > 1 ? (
                          <span className="rounded bg-primary/15 px-1 py-px text-[9px] uppercase tracking-wide text-primary">
                            {preset.skills.length} skills
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                        {preset.tagline}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => downloadPreset(preset)}
                        title={`Download ${preset.id}.zip`}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      >
                        <Download className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addPreset(preset)}
                        title={`Add ${preset.name} to your archive`}
                        className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Plus className="size-3" />
                        )}
                        Add
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/60">
                {visiblePresets.length} of {filteredPresets.length}
              </span>
              {visiblePresets.length < filteredPresets.length ? (
                <button
                  type="button"
                  onClick={() => setPresetLimit(presetLimit + 24)}
                  className="ml-auto rounded-md border border-border/70 px-2 py-1 text-[10px] font-medium transition-colors hover:bg-accent"
                >
                  Show 24 more
                </button>
              ) : null}
            </div>
          </div>

          {/* ---- model plugins ---- */}
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
            <div className="flex items-center gap-1.5">
              <Cpu className="size-3.5 text-primary" />
              <span className="hud-label" data-tone="cyan">
                AI model plugins
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                installed · {modelPlugins?.length ?? 0}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground/70">
              Engines a provider ships alongside its key. A switched-off
              plugin stays installed but is never used in AI chat — flip it
              on to let the router reach it.
            </p>
            <ul className="mt-2 space-y-1.5">
              {!modelPlugins?.length ? (
                <li className="py-3 text-center text-[11px] text-muted-foreground/70">
                  No model plugins ship with this build.
                </li>
              ) : (
                modelPlugins.map((plugin) => (
                  <li
                    key={plugin.slug}
                    className="flex items-start gap-2 rounded-md border border-border/60 bg-background/50 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-medium">
                          {plugin.title}
                        </span>
                        <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                          {plugin.providerLabel}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1 py-px text-[9px] uppercase tracking-wide",
                            plugin.enabled
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {plugin.enabled ? "in chat" : "installed"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                        {plugin.when}
                      </p>
                    </div>
                    <Switch
                      checked={plugin.enabled}
                      onCheckedChange={(checked) =>
                        void toggleModelPlugin(plugin.slug, checked)
                      }
                      aria-label={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.title} in AI chat`}
                    />
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* ---- drop zone ---- */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void store(file);
            }}
            className={cn(
              "rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border/70",
            )}
          >
            <Upload
              className={cn(
                "mx-auto size-5",
                dragging ? "text-primary" : "text-muted-foreground/60",
              )}
            />
            <p className="mt-2 text-sm text-foreground">
              Drop a plugin zip here
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground/70">
              Holds a Claude-style plugin folder (
              <span className="font-mono">.claude-plugin/plugin.json</span>) or
              MCP servers (<span className="font-mono">.mcp.json</span>). The
              file is kept exactly as you hand it over.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {busy ? "Storing…" : "Choose zip"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void store(file);
                // Reset so choosing the same file twice fires onChange again.
                e.target.value = "";
              }}
            />
          </div>

          {error ? (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          {/* ---- stored zips ---- */}
          {plugins === undefined ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              Reading your archive…
            </p>
          ) : plugins.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Archive className="mx-auto size-6 text-muted-foreground/50" />
              <p className="mt-2 text-sm text-foreground">Nothing stored yet</p>
              <p className="mx-auto mt-1 max-w-sm text-[11px] leading-4 text-muted-foreground/70">
                Add the zip of your plugins above and it stays yours: listed
                here, downloadable, and readable by name before you trust it.
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {plugins.map((plugin) => {
                const names = manifestNames(plugin.manifests);
                const skills = skillPaths(plugin.manifests);
                return (
                  <li
                    key={plugin._id}
                    className="hud-panel flex items-start gap-3 px-3 py-2.5"
                  >
                    <Archive className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {plugin.name}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1 py-px text-[9px] uppercase tracking-wide",
                            plugin.kind === "mcp"
                              ? "bg-violet-500/15 text-violet-300"
                              : "bg-primary/15 text-primary",
                          )}
                        >
                          {plugin.kind}
                        </span>
                        {plugin.version ? (
                          <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                            v{plugin.version}
                          </span>
                        ) : null}
                        {!plugin.enabled ? (
                          <span className="rounded bg-muted px-1 py-px text-[9px] text-muted-foreground">
                            off
                          </span>
                        ) : null}
                      </div>
                      {plugin.description ? (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {plugin.description}
                        </p>
                      ) : null}
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground/60">
                        {plugin.fileName} · {formatSize(plugin.sizeBytes)}
                        {plugin.fileCount
                          ? ` · ${plugin.fileCount} files`
                          : ""}
                        {names.length ? ` · ${names.join(", ")}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Switch
                        checked={plugin.enabled}
                        aria-label={
                          plugin.enabled
                            ? `Disable ${plugin.name}`
                            : `Enable ${plugin.name}`
                        }
                        onCheckedChange={(enabled) => {
                          void setEnabled({ pluginId: plugin._id, enabled });
                        }}
                      />
                      {plugin.url ? (
                        <a
                          href={plugin.url}
                          download={plugin.fileName}
                          title="Download the zip"
                          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Download className="size-3.5" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDelete(plugin._id)}
                        title={
                          confirmingId === plugin._id
                            ? "Click again to remove"
                            : "Remove"
                        }
                        className={cn(
                          "rounded p-1 transition-colors",
                          confirmingId === plugin._id
                            ? "text-rose-500"
                            : "text-muted-foreground hover:text-rose-500",
                        )}
                      >
                        {confirmingId === plugin._id ? (
                          <span className="text-[10px] font-medium">
                            Confirm
                          </span>
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                        title={
                          skills.length
                            ? `Open ${skills[0]}`
                            : "No skill files in this zip"
                        }
                        disabled={skills.length === 0}
                        onClick={() => {
                          const skill = skills[0];
                          if (!skill) return;
                          onOpenSkill?.(plugin._id as Id<"plugins">, skill);
                          onClose();
                        }}
                      >
                        <FileText className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ---- footer ---- */}
        <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-2">
          <span className="hud-label text-muted-foreground/60">
            Stored for your account · nothing executes from here
          </span>
          <Check className="ml-auto size-3 text-[var(--signal-green)]" />
        </div>
      </motion.div>
    </motion.div>
  );
}
