// ---------------------------------------------------------------------------
// Browse AI — the page reader behind character research and URL summaries.
//
// Browse AI is robot-based, not search-based: you train a robot that takes a
// URL and captures a few fields, then run it as a task and poll until it
// finishes. That is exactly the shape of "open this page and give me its
// text", which is the one job this file does. It cannot answer a search query,
// so it never stands in for Exa or Parallel.
//
// Everything here is pure so the request shapes and the result parsing can be
// tested without an account: the fetch and the polling live in convex/ai.ts.
// ---------------------------------------------------------------------------

export const BROWSE_AI_BASE = "https://api.browse.ai/v2";

/**
 * Accepted names for the key. The first is what the integration documents;
 * the rest are the variants people actually type into a keys panel.
 */
export const BROWSE_AI_KEY_ENVS = [
  "BROWSE_AI_API",
  "BROWSE_AI_API_KEY",
  "BROWSEAI_API_KEY",
] as const;

/** Accepted names for the robot. One robot reads one kind of page. */
export const BROWSE_AI_ROBOT_ENVS = [
  "BROWSE_AI_ROBOT_ID",
  "BROWSE_AI_ROBOTID",
  "BROWSE_AI_ROBOT",
] as const;

export interface BrowseAiConfig {
  key: string;
  robotId: string;
}

/**
 * A robot id goes straight into a URL path, so anything that could change the
 * path — a slash, a space, a pasted full URL — is rejected rather than sent.
 * Browse AI's ids are UUID-ish, which this accepts.
 */
export function isRobotId(value: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(value);
}

/**
 * Both halves are required. A key with no robot is the normal state for a
 * minute after someone pastes the key, so this returns null and every caller
 * quietly uses the older path instead of failing.
 */
export function browseAiConfig(
  read: (name: string) => string | undefined,
): BrowseAiConfig | null {
  const key = firstNonEmpty(read, BROWSE_AI_KEY_ENVS);
  const robotId = firstNonEmpty(read, BROWSE_AI_ROBOT_ENVS);
  if (!key || !robotId || !isRobotId(robotId)) return null;
  return { key, robotId };
}

function firstNonEmpty(
  read: (name: string) => string | undefined,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = read(name)?.trim();
    if (value) return value;
  }
  return null;
}

/** Where a task is created. `POST` with `browseAiTaskBody`. */
export function browseAiCreateUrl(robotId: string): string {
  return `${BROWSE_AI_BASE}/robots/${robotId}/tasks`;
}

/**
 * The body Browse AI expects. `originUrl` is the input parameter its starter
 * robots use; a robot that asks for something else at least fails loudly in
 * its own dashboard rather than silently reading the wrong page here.
 */
export function browseAiTaskBody(url: string): {
  inputParameters: { originUrl: string };
} {
  return { inputParameters: { originUrl: url } };
}

/** Where a started task is polled. */
export function browseAiTaskStatusUrl(
  robotId: string,
  taskId: string,
): string {
  return `${BROWSE_AI_BASE}/robots/${robotId}/tasks/${taskId}`;
}

export type BrowseAiStatus = "successful" | "failed" | "inProgress" | "unknown";

export function browseAiStatus(payload: unknown): BrowseAiStatus {
  const status = field(payload, "status");
  if (typeof status !== "string") return "unknown";
  const normalised = status.toLowerCase();
  if (normalised === "successful" || normalised === "finished") {
    return "successful";
  }
  if (normalised === "failed" || normalised === "error") return "failed";
  if (normalised === "inprogress" || normalised === "in_progress") {
    return "inProgress";
  }
  if (normalised === "queued" || normalised === "pending") return "inProgress";
  return "unknown";
}

/** The task id from either `{ id }` or the wrapper `{ result: { id } }`. */
export function browseAiTaskId(payload: unknown): string | null {
  for (const candidate of [field(payload, "id"), field(field(payload, "result"), "id")]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * Flatten whatever the robot captured into plain text for a model to read.
 *
 * The captured shape is per-robot, so this walks it rather than naming fields:
 * every non-URL string is kept, in document order, deduplicated and capped.
 * URLs are dropped because they carry no appearance detail and the brief this
 * feeds is about what is visible, not where it was read.
 */
export function browseAiText(payload: unknown, max = 4000): string {
  const strings: string[] = [];
  // Captured data sits under `result`; the wrapper's own status string is not
  // page content and must not reach the prompt.
  const body = field(payload, "result") ?? (field(payload, "status") ? undefined : payload);
  collect(body, strings, 0);

  const seen = new Set<string>();
  const kept: string[] = [];
  let budget = max;
  for (const raw of strings) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 2) continue;
    if (/^https?:\/\//i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (line.length > budget) {
      kept.push(line.slice(0, budget));
      budget = 0;
      break;
    }
    kept.push(line);
    budget -= line.length + 1;
    if (budget <= 0) break;
  }
  return kept.join("\n");
}

function collect(value: unknown, out: string[], depth: number): void {
  if (depth > 6 || out.length > 400) return;
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collect(item, out, depth + 1);
    }
  }
}

function field(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[name];
}
