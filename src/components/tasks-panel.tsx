import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlarmClock,
  Bell,
  BellOff,
  Clock,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  describeCountdown,
  describeSchedule,
  nextRunAt,
  timezoneLabel,
  type TaskKind,
} from "@/lib/schedule-time";

/**
 * Scheduled tasks.
 *
 * A task is a prompt plus a schedule. When it comes due, Jarvis runs it in the
 * background and writes the answer into a real chat — so a daily briefing
 * accumulates into one readable thread instead of a pile of notifications that
 * disappear by morning.
 *
 * Times are wall-clock local time, because that is how people schedule things:
 * "every day at 9am" means 9am where the user is.
 */

const KINDS: { value: TaskKind; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** "09:30" → 570 minutes past midnight. */
function parseTime(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}





/** ISO value for <input type="datetime-local">, in the browser's own timezone. */
function toLocalInputValue(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function TasksPanel({
  open,
  onOpenChange,
  sessionId,
  onOpenSession,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat a new task is most likely about, if one is open. */
  sessionId: Id<"chatSessions"> | null;
  onOpenSession: (sessionId: Id<"chatSessions">) => void;
}) {
  const tasks = useQuery(api.scheduledTasks.listTasks);
  const createTask = useMutation(api.scheduledTasks.createTask);
  const updateTask = useMutation(api.scheduledTasks.updateTask);
  const deleteTask = useMutation(api.scheduledTasks.deleteTask);
  const runTaskNow = useMutation(api.scheduledTasks.runTaskNow);

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<TaskKind>("daily");
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState("1");
  const [onceAt, setOnceAt] = useState(() => toLocalInputValue(Date.now()));
  const [postHere, setPostHere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  // A single clock, ticked once a minute, so the countdowns stay honest
  // without reading the wall clock during render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const minuteOfDay = parseTime(time) ?? 9 * 60;

  // The same arithmetic the server uses to decide whether a task is due, so
  // the preview cannot disagree with what actually happens.
  const preview = useMemo(() => {
    const next = nextRunAt(
      {
        kind,
        runAt: kind === "once" ? new Date(onceAt).getTime() : undefined,
        minuteOfDay,
        dayOfWeek: kind === "weekly" ? Number(day) : undefined,
        timezone,
      },
      now,
    );
    return Number.isFinite(next) ? next : null;
  }, [kind, onceAt, minuteOfDay, day, timezone, now]);

  const submit = async () => {
    setBusy(true);
    try {
      await createTask({
        title: title.trim() || prompt.trim().slice(0, 60),
        prompt,
        kind,
        runAt: kind === "once" ? new Date(onceAt).getTime() : undefined,
        minuteOfDay: kind === "daily" || kind === "weekly" ? minuteOfDay : undefined,
        dayOfWeek: kind === "weekly" ? Number(day) : undefined,
        timezone,
        sessionId: postHere && sessionId ? sessionId : undefined,
      });
      setTitle("");
      setPrompt("");
      toast.success("Task scheduled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not schedule that.");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (taskId: Id<"scheduledTasks">) => {
    setRunningId(taskId);
    try {
      const target = await runTaskNow({ taskId });
      await updateTask({ taskId, runNow: true });
      onOpenSession(target);
      toast.success("Running now — the answer lands in that chat.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run that task.");
    } finally {
      setRunningId(null);
    }
  };

  const rows = tasks ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="size-4" />
            Scheduled tasks
          </DialogTitle>
          <DialogDescription>
            Jarvis runs these on its own and files the answer into a chat. Times
            are your local time ({timezoneLabel(timezone, now)}).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              Nothing scheduled yet. A morning briefing or a weekly review are
              the usual first two.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((task) => {
                const next =
                  task.enabled === false
                    ? null
                    : nextRunAt(
                        {
                          kind: task.kind,
                          runAt: task.runAt,
                          minuteOfDay: task.minuteOfDay,
                          dayOfWeek: task.dayOfWeek,
                          timezone: task.timezone,
                        },
                        task.lastRunAt ?? 0,
                      );
                return (
                  <li key={task._id} className="rounded-md border px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {task.title}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="size-3" />
                          {describeSchedule(task)}
                          {next ? (
                            <span className="text-primary/80">
                              {" · "}
                              {describeCountdown(next, now)}
                            </span>
                          ) : (
                            <span>{" · paused"}</span>
                          )}
                        </p>
                        {task.lastResult ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
                            Last run: {task.lastResult}
                          </p>
                        ) : null}
                      </div>

                      <Switch
                        checked={task.enabled !== false}
                        onCheckedChange={(checked) =>
                          void updateTask({ taskId: task._id, enabled: checked })
                        }
                        aria-label={task.enabled === false ? "Resume task" : "Pause task"}
                      />

                      <div className="flex shrink-0 items-center">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Run now"
                          disabled={runningId === task._id}
                          onClick={() => void runNow(task._id)}
                        >
                          {runningId === task._id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Play className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          title="Delete task"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void deleteTask({ taskId: task._id })}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <Label className="text-sm font-medium">New task</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title, e.g. “Morning briefing”"
            aria-label="Task title"
          />
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="What should Jarvis do? e.g. “Summarise the top AI news in the last 24 hours and flag anything I should act on.”"
            aria-label="Task prompt"
          />

          <div className="flex flex-wrap items-end gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as TaskKind)}>
              <SelectTrigger className="w-36" aria-label="Repeat">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {kind === "daily" && (
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-32"
                aria-label="Time"
              />
            )}

            {kind === "weekly" && (
              <>
                <Select value={day} onValueChange={setDay}>
                  <SelectTrigger className="w-32" aria-label="Day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-32"
                  aria-label="Time"
                />
              </>
            )}

            {kind === "once" && (
              <Input
                type="datetime-local"
                value={onceAt}
                onChange={(e) => setOnceAt(e.target.value)}
                className="w-56"
                aria-label="Run at"
              />
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={postHere}
              disabled={!sessionId}
              onChange={(e) => setPostHere(e.target.checked)}
              className="size-3.5 accent-[hsl(var(--primary))]"
            />
            {sessionId
              ? "Post into the current chat"
              : "Open a chat to post into this one"}
          </label>

          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {preview ? (
                <>
                  {kind === "once" ? (
                    <Bell className="size-3" />
                  ) : (
                    <BellOff className="size-3" />
                  )}
                  {describeSchedule({
                    kind,
                    runAt: kind === "once" ? new Date(onceAt).getTime() : undefined,
                    minuteOfDay,
                    dayOfWeek: kind === "weekly" ? Number(day) : undefined,
                    timezone,
                  })}{" "}
                  · next {describeCountdown(preview, now)}
                </>
              ) : (
                "Pick a valid time"
              )}
            </span>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={busy || !prompt.trim() || !preview}
            >
              <Plus className="size-3.5" />
              {busy ? "Scheduling…" : "Schedule"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
