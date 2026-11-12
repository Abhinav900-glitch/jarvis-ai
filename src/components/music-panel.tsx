import { useState } from "react";
import { motion } from "framer-motion";
import {
  Download,
  Loader2,
  Music,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function ago(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString();
}

/** One tap of a mood, so the prompt box is never an empty page. */
const STYLES = [
  "lo-fi hip hop",
  "cinematic strings",
  "synthwave",
  "warm acoustic guitar",
  "ambient piano",
  "afrobeat",
  "orchestral trailer",
  "jazz trio",
];

const LENGTHS = [
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
];

export function MusicPanel({ onClose }: { onClose: () => void }) {
  const data = useQuery(api.cloud.list);
  const providerList = useQuery(api.music.providers);
  const generate = useAction(api.music.generate);
  const removeFile = useMutation(api.cloud.remove);

  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [instrumental, setInstrumental] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Id<"cloudFiles"> | null>(null);

  const tracks = (data?.files ?? []).filter((file) => file.source === "music");
  const available = (providerList ?? []).filter((p) => p.available);

  const addStyle = (style: string) => {
    setPrompt((prev) => {
      const base = prev.trim();
      if (!base) return `${style} instrumental track`;
      if (base.toLowerCase().includes(style.toLowerCase())) return base;
      return `${base}, ${style.toLowerCase()}`;
    });
  };

  const run = async () => {
    const ask = prompt.trim();
    if (ask.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const track = await generate({ prompt: ask, seconds, instrumental });
      setNote(
        `Made with ${track.label} · ${track.seconds}s · saved to your cloud`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The track did not finish.",
      );
    } finally {
      setBusy(false);
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
      setError(err instanceof Error ? err.message : "Could not delete that track.");
    }
  };

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
          <Music className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Music
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            a real track, not a description of one
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title="Close"
          >
            <X className="size-3" />
          </button>
        </div>

        <div className="rounded-lg border border-border/60 p-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            rows={2}
            maxLength={800}
            placeholder="A slow, nostalgic piano piece for a rainy night — instrumental, no vocals…"
            className="w-full resize-none bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
            aria-label="Describe the music"
          />

          <div className="mt-1 flex flex-wrap items-center gap-1">
            {STYLES.map((style) => (
              <button
                key={style}
                onClick={() => addStyle(style)}
                className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {style}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Length
            </span>
            {LENGTHS.map((option) => (
              <button
                key={option.seconds}
                onClick={() => setSeconds(option.seconds)}
                className={`rounded border px-2 py-0.5 text-[10px] transition-colors ${
                  seconds === option.seconds
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
            <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={instrumental}
                onChange={(e) => setInstrumental(e.target.checked)}
                className="size-3 accent-foreground"
              />
              Instrumental
            </label>
            <button
              onClick={() => void run()}
              disabled={busy || prompt.trim().length < 3}
              className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Sparkles className="size-3" />
              )}
              {busy ? "Composing" : "Generate"}
            </button>
          </div>
        </div>

        {busy ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Composing {seconds}s — this can take up to a minute.
          </p>
        ) : error ? (
          <p className="mt-1.5 text-[11px] text-destructive">{error}</p>
        ) : note ? (
          <p className="mt-1.5 text-[11px] text-emerald-500/80">{note}</p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground/70">
            {available.length > 0
              ? `Tries ${available.map((p) => p.label).join(" → ")}, in the order your keys are set. Tracks land in your cloud.`
              : "No music key yet — add GEMINI_API_KEY, ELEVENLABS_API_KEY, LOUDLY_AI_API_KEY or REPLICATE_API_TOKEN in the Keys tab."}
          </p>
        )}

        <div className="mt-2">
          {tracks.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border/60 px-3 py-5 text-center">
              <Music className="size-5 text-muted-foreground/60" />
              <span className="text-[11px] text-muted-foreground">
                Nothing composed yet.
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                Describe a track above and Jarvis will write and record it.
              </span>
            </div>
          ) : (
            <ul className="max-h-64 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/60">
              {tracks.map((track) => (
                <li key={track.id} className="group px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs leading-4">{track.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground/60">
                        {formatBytes(track.size)} · generated · {ago(track.createdAt)}
                      </p>
                    </div>
                    {track.url ? (
                      <a
                        href={track.url}
                        download={track.name}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded p-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100"
                        title="Download"
                      >
                        <Download className="size-3.5" />
                      </a>
                    ) : null}
                    <button
                      onClick={() => void handleDelete(track.id)}
                      className={`rounded p-1 text-[10px] transition-colors ${
                        confirm === track.id
                          ? "bg-destructive/10 text-destructive"
                          : "text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                      }`}
                      title={
                        confirm === track.id ? "Click again to delete" : "Delete"
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {track.url ? (
                    <audio
                      controls
                      preload="none"
                      src={track.url}
                      className="mt-1.5 h-8 w-full"
                    />
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground/60">
                      The audio is missing — delete the row to clean up.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}
