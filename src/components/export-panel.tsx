import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Download, FileText, X } from "lucide-react";
import {
  EXPORT_FORMATS,
  copyExport,
  downloadExport,
  type ExportFormat,
  type ExportSession,
} from "@/lib/export-chat";

export function ExportPanel({
  session,
  messageCount,
  onClose,
}: {
  session: ExportSession;
  messageCount: number;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleDownload = () => {
    if (busy) return;
    setBusy(true);
    try {
      downloadExport(session, format);
    } finally {
      window.setTimeout(() => setBusy(false), 300);
    }
  };

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    setCopied(false);
    try {
      await copyExport(session, format);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    } finally {
      setBusy(false);
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Download className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Export conversation
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {messageCount} {messageCount === 1 ? "message" : "messages"}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3" />
          </button>
        </div>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormat(f.id)}
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                format === f.id
                  ? "border-foreground/30 bg-accent"
                  : "border-border/60 hover:bg-accent/50"
              }`}
            >
              <FileText
                className={`mt-0.5 size-3.5 shrink-0 ${
                  format === f.id ? "text-foreground" : "text-muted-foreground"
                }`}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium">{f.label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {f.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex gap-2">
          <button
            onClick={handleDownload}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Download className="size-3" />
            Download
          </button>
          <button
            onClick={() => void handleCopy()}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            {copied ? (
              <>
                <Check className="size-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3" />
                Copy
              </>
            )}
          </button>
        </div>

        <p className="mt-2 text-[11px] text-muted-foreground/70">
          {session.title
            ? `Saving “${session.title}”.`
            : "Saving the current conversation."}{" "}
          Images, attachments, model names and cited sources are included.
        </p>
      </div>
    </motion.div>
  );
}
