import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Gauge, RotateCcw, ShieldCheck, Smile, Volume2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  BEHAVIOR_AXES,
  BEHAVIOR_OPTIONS,
  BEHAVIOR_PRESETS,
  DEFAULT_BEHAVIOR,
  behaviorBlock,
  type BehaviorAxis,
  type BehaviorPolicy,
} from "@/lib/personalization";

/**
 * The personalization editor — Jarvis's behaviour as settings, not as prose.
 *
 * Four axes instead of a free-text box because a text box is easy to write and
 * easy for a model to skim. Each axis becomes one line of a numbered regulation
 * with a compliance step (see `behaviorBlock`), so the choice is something the
 * reply is checked against rather than a mood the model is asked to adopt.
 *
 * The preview is not decoration: it renders the exact block appended to the
 * system prompt, so nobody has to guess what their chips turned into.
 */
export function PersonalizationEditor({
  value,
  saveBehavior,
}: {
  value: BehaviorPolicy | null;
  saveBehavior: ReturnType<typeof useMutation<typeof api.workspace.saveBehavior>>;
}) {
  const [draft, setDraft] = useState<BehaviorPolicy>(value ?? DEFAULT_BEHAVIOR);
  // Whether the user has changed anything since opening. Needed because an
  // untouched account already sits on the defaults: comparing the draft to the
  // saved value alone would report "unsaved changes" on a screen nobody edited.
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const dirty = value
    ? BEHAVIOR_AXES.some((axis) => draft[axis] !== value[axis])
    : touched;

  const pick = (next: BehaviorPolicy) => {
    setTouched(true);
    setDraft(next);
  };

  const set = (axis: BehaviorAxis, option: string) => {
    pick({ ...draft, [axis]: option } as BehaviorPolicy);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveBehavior({ behavior: draft });
      setTouched(false);
      toast.success("Personalization saved — it applies from your next reply.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await saveBehavior({ behavior: null });
      setDraft(DEFAULT_BEHAVIOR);
      setTouched(false);
      toast.success("Personalization cleared — back to the house style.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Behaviour rules Jarvis must follow
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              These travel with every reply as a{" "}
              <span className="font-medium text-foreground">regulation</span>,
              with an explicit instruction to re-read each rule before sending
              and rewrite anything that breaks one. A rule the model has to check
              itself against is one it keeps; a style note buried in a long
              prompt is one it skims.
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Start from a preset
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BEHAVIOR_PRESETS.map((preset) => {
            const active = BEHAVIOR_AXES.every(
              (axis) => draft[axis] === preset.policy[axis],
            );
            return (
              <button
                key={preset.id}
                type="button"
                title={preset.blurb}
                onClick={() => pick(preset.policy)}
                className={`max-sm:px-3 max-sm:py-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span aria-hidden className="mr-1">
                  {preset.emoji}
                </span>
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {BEHAVIOR_AXES.map((axis) => {
          const meta = BEHAVIOR_OPTIONS[axis];
          return (
            <div key={axis} className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-xs font-medium">{meta.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {meta.hint}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {meta.values.map((option) => {
                  const active = draft[axis] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={active}
                      onClick={() => set(axis, option)}
                      className={`max-sm:px-3 max-sm:py-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        active
                          ? "border-primary bg-primary/10 font-medium text-foreground"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {(meta.labels as Record<string, string>)[option]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save personalization"}
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
        >
          <Gauge className="size-3.5" />
          {showPreview ? "Hide" : "Show"} what Jarvis receives
        </Button>
        {value && (
          <Button variant="ghost" onClick={() => void reset()} disabled={saving}>
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {value
          ? "Active on every reply, in every chat, whichever model answers."
          : "Not set — Jarvis is using its default house style. Pick a preset or a few options and save to take over."}
      </p>

      {showPreview && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-start gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Volume2 className="mt-0.5 size-3 shrink-0" />
            <span>
              Spoken replies in live mode get the same rules, minus Markdown and
              emoji.
            </span>
          </div>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
            {behaviorBlock(draft)}
          </pre>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-[11px] text-muted-foreground">
        <Smile className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Personalization shapes how Jarvis answers, never what it is allowed to
          claim — the honesty and safety rules in the base prompt sit above these
          and cannot be relaxed from here.
        </span>
      </div>
    </div>
  );
}
