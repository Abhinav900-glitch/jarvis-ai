// ---------------------------------------------------------------------------
// Schedule arithmetic for scheduled tasks.
//
// Deliberately free of Convex imports so the browser can import it too and
// show the user exactly when a task will next run, computed by the same code
// that decides whether it is due.
//
// The recurring cases are all expressed in LOCAL wall-clock time, because that
// is how people schedule things. "Every day at 9am" means 9am where the user
// is, not 9am UTC — a task that fires at 4am because of a timezone offset is
// worse than no task at all.
// ---------------------------------------------------------------------------

export type TaskKind = "once" | "hourly" | "daily" | "weekly";

export interface TaskSchedule {
  kind: TaskKind;
  /** For "once": the wall-clock time to fire, ms epoch. */
  runAt?: number;
  /** For "daily"/"weekly": minutes past local midnight. */
  minuteOfDay?: number;
  /** For "weekly": 0 = Sunday, matching Date#getDay. */
  dayOfWeek?: number;
  /** IANA zone name, e.g. "Asia/Kolkata". */
  timezone?: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Used when the browser cannot report a zone. */
export const FALLBACK_TIMEZONE = "UTC";

/**
 * The start of the local day containing `at`, as a UTC timestamp.
 *
 * Computed by probing rather than by subtracting a fixed offset, because the
 * offset depends on the date. Subtracting "5h30m" lands on the wrong day twice
 * a year and makes the task fire at the wrong hour for those two weeks.
 */
export function startOfLocalDay(at: number, timezone: string): number {
  const probe = new Date(at);
  const utcMidnight = Date.UTC(
    probe.getUTCFullYear(),
    probe.getUTCMonth(),
    probe.getUTCDate(),
  );

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(new Date(utcMidnight));
  } catch {
    // An unknown zone falls back to UTC rather than throwing mid-sweep.
    return utcMidnight;
  }

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const localMidnightAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // Intl renders midnight as 24 in some locales; normalise it to 0.
    get("hour") % 24,
    get("minute"),
    get("second"),
  );

  return utcMidnight - (localMidnightAsUtc - utcMidnight);
}

/** The zone-abbreviation label shown next to a task ("GMT+5:30", "PST"). */
export function timezoneLabel(timezone: string | undefined, at = Date.now()): string {
  const zone = timezone || FALLBACK_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(new Date(at));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? zone;
  } catch {
    return zone;
  }
}

/**
 * When this task should next fire, strictly after `from`.
 *
 * `from` is normally the last run time, so a daily task re-anchors to the last
 * run rather than drifting forward from whenever the sweep happened to notice
 * it — which is how a "daily at 9am" job quietly becomes a job that runs at
 * 9:07, 9:12, 9:19 and stops meaning anything.
 */
export function nextRunAt(schedule: TaskSchedule, from: number): number {
  const timezone = schedule.timezone || FALLBACK_TIMEZONE;

  switch (schedule.kind) {
    case "once":
      return schedule.runAt ?? from + MINUTE;

    case "hourly":
      // Snap to the next whole hour after `from`.
      return Math.ceil((from + MINUTE) / HOUR) * HOUR;

    case "daily": {
      const minuteOfDay = schedule.minuteOfDay ?? 9 * 60;
      const today = startOfLocalDay(from, timezone) + minuteOfDay * MINUTE;
      if (today > from) return today;
      // Already past today's slot: take tomorrow's.
      return startOfLocalDay(from + DAY, timezone) + minuteOfDay * MINUTE;
    }

    case "weekly": {
      const minuteOfDay = schedule.minuteOfDay ?? 9 * 60;
      const target = schedule.dayOfWeek ?? 1;
      for (let i = 0; i <= 7; i++) {
        const dayStart = startOfLocalDay(from + i * DAY, timezone);
        // Read the weekday from local noon, so a zone far from UTC cannot shift
        // the date and report the wrong day.
        const weekday = new Date(dayStart + 12 * HOUR).getUTCDay();
        if (weekday !== target) continue;
        const candidate = dayStart + minuteOfDay * MINUTE;
        if (candidate > from) return candidate;
      }
      return from + DAY;
    }
  }
}

/** True when the task is due to run right now. */
export function isDue(schedule: TaskSchedule, lastRunAt: number | undefined, now: number): boolean {
  const anchor = lastRunAt ?? 0;
  // A brand-new task with no lastRunAt anchors at the epoch, so the first
  // sweep fires it as soon as its own start time has arrived.
  return nextRunAt(schedule, anchor) <= now;
}

/** "Every day at 09:00", for the task list. */
export function describeSchedule(schedule: TaskSchedule): string {
  const minuteOfDay = schedule.minuteOfDay ?? 9 * 60;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");

  switch (schedule.kind) {
    case "once": {
      const at = schedule.runAt ?? Date.now();
      return `Once · ${new Date(at).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;
    }
    case "hourly":
      return "Every hour";
    case "daily":
      return `Every day at ${hh}:${mm}`;
    case "weekly": {
      const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return `Every ${days[schedule.dayOfWeek ?? 1]} at ${hh}:${mm}`;
    }
  }
}

/** A short relative description of how far away a fire time is. */
export function describeCountdown(target: number, now = Date.now()): string {
  const delta = target - now;
  if (delta <= 0) return "due now";
  const minutes = Math.round(delta / MINUTE);
  if (minutes < 1) return "in under a minute";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}
