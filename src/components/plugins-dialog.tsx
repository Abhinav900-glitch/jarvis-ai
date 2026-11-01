import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import type { GenericId } from "convex/values";
import type { Id } from "@/convex/_generated/dataModel";
import {
  AlertTriangle,
  Archive,
  Check,
  Download,
  FileText,
  Loader2,
  Puzzle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { inspectZip } from "@/lib/zip-inspect";

/** Mirrors the server cap, so a doomed upload is refused before it starts. */
const MAX_ZIP_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Names recorded inside the zip at upload time, for the row's summary line. */
function manifestNames(manifests: string | undefined): string[] {
  if (!manifests) return [];
  try {
    const parsed = JSON.parse(manifests) as { name?: string }[];
    return Array.isArray(parsed)
      ? parsed.map((m) => m.name).filter((n): n is string => Boolean(n))
      : [];
  } catch {
    return [];
  }
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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingId, setConfirmingId] = useState<
    GenericId<"plugins"> | null
  >(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

      await save({
        fileName: file.name,
        storageId,
        name: primary?.name ?? file.name.replace(/\.zip$/i, ""),
        kind: pluginManifest ? "plugin" : holdsMcp ? "mcp" : "plugin",
        version: primary?.version,
        description: primary?.description,
        sizeBytes: file.size,
        fileCount: info.entries.length,
        manifests: JSON.stringify(info.manifests),
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

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.99 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="hud-panel hud-corners flex max-h-[84vh] w-full max-w-2xl flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Plugins"
      >
        {/* ---- header ---- */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
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
                              : "bg-cyan-500/15 text-cyan-400",
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
                      </button>                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                          title={`Open a skill from ${plugin.name}`}
                          disabled={plugin.kind !== "plugin" || !plugin.manifests}
                          onClick={() => {
                            const names = manifestNames(plugin.manifests);
                            const firstSkill = names.find(
                              (n) => n.endsWith(".md") || !n.includes("/"),
                            );
                            if (firstSkill) {
                              onOpenSkill?.(plugin._id as Id<"plugins">, firstSkill);
                              onClose();
                            }
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
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2">
          <span className="hud-label text-muted-foreground/60">
            Stored for your account · nothing executes from here
          </span>
          <Check className="ml-auto size-3 text-[var(--signal-green)]" />
        </div>
      </motion.div>
    </motion.div>
  );
}
