import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check,
  CircleAlert,
  Cpu,
  Database,
  HardDriveDownload,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

function Row({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500/80" />
      ) : (
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0">
        <p className="text-xs">{label}</p>
        <p className="break-words text-[11px] leading-4 text-muted-foreground/70">
          {detail}
        </p>
      </div>
    </div>
  );
}

function gb(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * The two halves of "I have a GGUF on my disk and want Jarvis to use it".
 *
 * They are shown together because they fail independently and the fix is
 * different in each case: the runtime is a tunnel plus a running server, the
 * weights are a bucket plus an upload. Neither is inferred from configuration
 * alone — both are probed, since a stopped tunnel and an empty bucket look
 * identical from the chat window.
 */
export function ModelVaultPanel({ onClose }: { onClose: () => void }) {
  const loadStatus = useAction(api.vault.status);
  const getUploadUrl = useAction(api.vault.presignUploadUrl);
  const getDownloadUrl = useAction(api.vault.presignDownloadUrl);
  const fileInput = useRef<HTMLInputElement>(null);
  type VaultStatus = Awaited<ReturnType<typeof loadStatus>>;

  const [report, setReport] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await loadStatus({}));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read vault status.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const { url } = await getUploadUrl({});

      // XHR rather than fetch: this is a multi-gigabyte body, and fetch still
      // has no portable way to report upload progress. The only thing the user
      // needs from this transfer is a percentage, and they are watching a
      // 2 GB upload.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", url);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload rejected (${xhr.status}).`));
        xhr.onerror = () =>
          reject(
            new Error(
              "Upload failed. If the bucket is CORS-restricted, add your site origin to the R2 bucket's CORS policy.",
            ),
          );
        xhr.send(file);
      });

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const handleDownload = async () => {
    setError(null);
    try {
      const { url } = await getDownloadUrl({});
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make a download link.");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="border-t px-6 py-3"
    >
      <div className="mx-auto max-w-2xl">
        <div className="mb-2 flex items-center gap-2">
          <Cpu className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Model vault
          </span>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Check
          </button>
          <button
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3" />
          </button>
        </div>

        {!report ? (
          <button
            onClick={() => void refresh()}
            className="w-full rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-foreground/25"
          >
            {loading ? "Checking…" : "Check the vault"}
          </button>
        ) : (
          <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <Row
              ok={report.runtime.reachable}
              label={`Local runtime — ${report.runtime.selected}`}
              detail={report.runtime.detail}
            />
            <Row
              ok={report.storage.uploaded}
              label={`Weights in storage${report.storage.sizeBytes ? ` — ${gb(report.storage.sizeBytes)}` : ""}`}
              detail={
                !report.storage.configured
                  ? "Set R2_BUCKET_NAME, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY."
                  : report.storage.uploaded
                    ? `models/fable-5.gguf is in ${report.storage.bucket}.`
                    : "Not uploaded yet — pick the .gguf below."
              }
            />
          </div>
        )}

        {report?.runtime.models.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {report.runtime.models.map((m) => (
              <span
                key={m}
                className={`rounded border px-1.5 py-0.5 text-[10px] ${
                  m === report.runtime.selected
                    ? "border-foreground/30 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {m}
              </span>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".gguf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading || !report?.storage.configured}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            {uploading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Upload className="size-3" />
            )}
            {uploading
              ? progress === null
                ? "Uploading…"
                : `Uploading ${progress}%`
              : "Upload .gguf"}
          </button>
          {report?.storage.uploaded ? (
            <button
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
            >
              <HardDriveDownload className="size-3" />
              Download
            </button>
          ) : null}
        </div>

        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground/70">
          <Database className="mt-px size-3 shrink-0" />
          <span>
            The weights stream straight from your browser to the bucket — never
            through the chat backend. The local model runs last in the fallback
            chain, so hosted engines still answer by default.
          </span>
        </p>
      </div>
    </motion.div>
  );
}