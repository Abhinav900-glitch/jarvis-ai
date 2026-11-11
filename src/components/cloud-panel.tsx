import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Cloud,
  CloudUpload,
  Download,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const SOURCE_LABEL: Record<string, string> = {
  upload: "upload",
  run: "from a run",
  image: "image",
};

export function CloudPanel({ onClose }: { onClose: () => void }) {
  const data = useQuery(api.cloud.list);
  const createUpload = useMutation(api.cloud.createUpload);
  const saveUpload = useMutation(api.cloud.save);
  const keepRun = useMutation(api.cloud.keepRun);
  const removeFile = useMutation(api.cloud.remove);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Id<"cloudFiles"> | null>(null);
  const [dragging, setDragging] = useState(false);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setNote(null);
    let saved = 0;
    for (const file of files) {
      setBusy(file.name);
      try {
        const url = await createUpload();
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
        const { storageId } = (await res.json()) as {
          storageId: Id<"_storage">;
        };
        await saveUpload({
          storageId,
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
        });
        saved += 1;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "That upload did not finish.",
        );
      }
    }
    setBusy(null);
    if (saved > 0) {
      setNote(`${saved} ${saved === 1 ? "file" : "files"} in your cloud.`);
      window.setTimeout(() => setNote(null), 3000);
    }
  };

  const handleKeep = async (id: Id<"agentArtifacts">) => {
    setError(null);
    setBusy("keep");
    try {
      await keepRun({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not keep that file.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: Id<"cloudFiles">) => {
    if (confirm !== id) {
      setConfirm(id);
      window.setTimeout(() => setConfirm((c) => (c === id ? null : c)), 3000);
      return;
    }
    setConfirm(null);
    setError(null);
    try {
      await removeFile({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that file.");
    }
  };

  const used = data?.used ?? 0;
  const limit = data?.limit ?? 1;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const files = data?.files ?? [];
  const recent = data?.recentRuns ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="border-t px-4 py-3 sm:px-6"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Cloud className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Your cloud
          </span>
          {data ? (
            <span className="text-[10px] text-muted-foreground/60">
              {data.count} {data.count === 1 ? "file" : "files"} ·{" "}
              {formatBytes(used)} of {formatBytes(limit)}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
              title="Upload a file"
            >
              {busy !== null ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Upload className="size-3" />
              )}
              Upload
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Close"
            >
              <X className="size-3" />
            </button>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadFiles(picked);
          }}
        />

        {/* Quota meter: the number is the promise the account makes. */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              pct > 90 ? "bg-amber-500" : "bg-primary/70"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            // Moving between children fires leave on the parent; only a real
            // exit should drop the highlight.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void uploadFiles(Array.from(e.dataTransfer.files ?? []));
          }}
          className={`mt-2 rounded-lg border border-dashed transition-colors ${
            dragging ? "border-primary/60 bg-primary/5" : "border-border/60"
          }`}
        >
          {busy && busy !== "keep" ? (
            <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Uploading {busy}…
            </div>
          ) : files.length === 0 ? (
            <button
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1 px-3 py-5 text-center transition-colors hover:bg-accent/20"
            >
              <CloudUpload className="size-5 text-muted-foreground/60" />
              <span className="text-[11px] text-muted-foreground">
                Drop files here, or click to choose.
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {formatBytes(data?.maxFile ?? 0)} per file · kept for as long as
                you want them
              </span>
            </button>
          ) : (
            <ul className="max-h-56 divide-y divide-border/40 overflow-y-auto">
              {files.map((file) => (
                <li
                  key={file.id}
                  className="group flex items-center gap-2 px-3 py-1.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border/50 bg-muted/40">
                    {file.mime.startsWith("image/") && file.url ? (
                      <img
                        src={file.url}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : file.mime.startsWith("image/") ? (
                      <ImageIcon className="size-3.5 text-muted-foreground/70" />
                    ) : (
                      <FileText className="size-3.5 text-muted-foreground/70" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs leading-4">{file.name}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {formatBytes(file.size)} · {SOURCE_LABEL[file.source] ?? "file"} ·{" "}
                      {ago(file.createdAt)}
                    </p>
                  </div>
                  {file.url ? (
                    <a
                      href={file.url}
                      download={file.name}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded p-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100"
                      title="Download"
                    >
                      <Download className="size-3.5" />
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/50">
                      missing
                    </span>
                  )}
                  <button
                    onClick={() => void handleDelete(file.id)}
                    className={`rounded p-1 text-[10px] transition-colors ${
                      confirm === file.id
                        ? "bg-destructive/10 text-destructive"
                        : "text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                    }`}
                    title={confirm === file.id ? "Click again to delete" : "Delete"}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {recent.length > 0 && busy !== "keep" ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <HardDrive className="size-3 text-muted-foreground/60" />
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              From your runs
            </span>
            {recent.slice(0, 4).map((file) => (
              <button
                key={file.id}
                onClick={() => void handleKeep(file.id)}
                disabled={busy !== null}
                className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                title={`Keep ${file.name} in your cloud`}
              >
                <CloudUpload className="size-2.5 shrink-0" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-muted-foreground/50">Keep</span>
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="mt-1.5 text-[11px] text-destructive">{error}</p>
        ) : note ? (
          <p className="mt-1.5 text-[11px] text-emerald-500/80">{note}</p>
        ) : null}

        <p className="mt-2 text-[11px] leading-4 text-muted-foreground/70">
          Signed in, so these files are yours across devices, not tied to the
          browser that uploaded them.
        </p>
      </div>
    </motion.div>
  );
}
