import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Check,
  Database,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const KIND_META: Record<string, { label: string; icon: string }> = {
  fact: { label: "Fact", icon: "◆" },
  preference: { label: "Prefers", icon: "★" },
  note: { label: "Note", icon: "✎" },
};

function relativeTime(ms: number) {
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

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const memories = useQuery(api.memories.list, { limit: 100 });
  // These are actions rather than mutations because forgetting has to reach the
  // MongoDB corpus as well as the Convex row — only the node runtime can do
  // that, so the panel can no longer call a plain mutation here.
  const backend = useQuery(api.memories.backend, {});
  const rememberFact = useAction(api.memory.remember);
  const forgetFact = useAction(api.memory.forget);
  const forgetAllFacts = useAction(api.memory.forgetAll);

  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = memories ?? [];

  const handleAdd = async () => {
    const content = draft.trim();
    if (!content || adding) return;
    setAdding(true);
    setError(null);
    try {
      await rememberFact({ content });
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: Id<"memories">) => {
    setError(null);
    try {
      await forgetFact({ id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not forget that.");
    }
  };

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      window.setTimeout(() => setConfirmClear(false), 3000);
      return;
    }
    setClearing(true);
    setConfirmClear(false);
    setError(null);
    try {
      await forgetAllFacts({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear memory.");
    } finally {
      setClearing(false);
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
          <Brain className="size-3.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Long-term memory
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {rows.length} {rows.length === 1 ? "item" : "items"}
          </span>
          {rows.length > 0 ? (
            <button
              onClick={() => void handleClear()}
              disabled={clearing}
              className={`ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest transition-colors disabled:opacity-50 ${
                confirmClear
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground hover:text-destructive"
              }`}
              title="Forget everything Jarvis knows about you"
            >
              {clearing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : confirmClear ? (
                "Tap again to confirm"
              ) : (
                <>
                  <Trash2 className="size-3" />
                  Forget all
                </>
              )}
            </button>
          ) : null}
          <button
            onClick={onClose}
            className={`rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground ${
              rows.length > 0 ? "" : "ml-auto"
            }`}
            title="Close"
          >
            <X className="size-3" />
          </button>
        </div>

        {/* Manual "remember this" — the automatic pass can miss things you
            care about, and this makes it explicit. */}
        <div className="mb-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="Tell Jarvis to remember something…"
            className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
          />
          <button
            onClick={() => void handleAdd()}
            disabled={!draft.trim() || adding}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
          >
            {adding ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <>
                <Plus className="size-3" />
                Remember
              </>
            )}
          </button>
        </div>

        {error ? (
          <p className="mb-2 text-xs text-destructive">{error}</p>
        ) : null}

        {memories === undefined ? (
          <p className="text-xs text-muted-foreground">Loading memory…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-4 text-center">
            <Sparkles className="mx-auto size-4 text-muted-foreground/50" />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Nothing remembered yet. Jarvis picks up durable facts as you talk
              — where you live, how you like replies, what you&apos;re building.
            </p>
          </div>
        ) : (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto">
            <AnimatePresence initial={false}>
              {rows.map((m) => {
                const meta = KIND_META[m.kind] ?? KIND_META.fact;
                return (
                  <motion.li
                    key={m._id}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18 }}
                    className="group flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                  >
                    <span
                      className="mt-0.5 shrink-0 text-[10px] text-muted-foreground"
                      title={meta.label}
                    >
                      {meta.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-5">{m.content}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                        {meta.label} · {relativeTime(m.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => void handleDelete(m._id)}
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Forget this"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}

        {/* Where memory actually lives. Surfaced because the quality of recall
            depends entirely on it, and a silent fallback looks identical to a
            working setup from the outside. */}
        {backend ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1">
              <Database className="size-3" />
              {backend.storeLabel}
            </span>
            <span>{backend.embeddingsLabel}</span>
            <span>
              {backend.reranking ? "Reranking on" : "Reranking off"}
            </span>
            {backend.fullyConfigured ? null : (
              <span className="text-amber-500/70">
                Add VOYAGE_API_KEY + MONGODB_DATA_API_URL + MONGODB_API_KEY for
                full recall
              </span>
            )}
          </div>
        ) : null}

        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground/70">
          <Check className="mt-px size-3 shrink-0" />
          <span>
            These notes are injected into every reply. Secrets and one-off
            chit-chat are never stored.
          </span>
        </p>
      </div>
    </motion.div>
  );
}