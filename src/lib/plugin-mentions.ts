// ---------------------------------------------------------------------------
// `@plugin/skill` mentions in the composer.
//
// A plugin is a zip of Markdown skills, so "running" one in chat means handing
// the model that skill's instructions for the turn. Typing `@` lists the skills
// found in the user's stored zips; picking one writes `@plugin/skill` into the
// message, and on send the token is stripped and resolved back to the zip entry
// the server should open.
//
// A plugin can hold several skills, so the mention always names both halves —
// `@brand-kit/tone-of-voice` — because the skill alone would be ambiguous.
// ---------------------------------------------------------------------------

/** The plugin row fields this module reads. */
export interface PluginRow {
  _id: string;
  name: string;
  kind?: string;
  enabled: boolean;
  /** JSON array of { path, kind, name?, version?, description? }. */
  manifests?: string | null;
}

/** One skill file inside a stored plugin zip. */
export interface PluginSkillEntry {
  pluginId: string;
  pluginName: string;
  /** Path inside the zip, e.g. `skills/tone.md` — what the server opens. */
  skillName: string;
  /** What gets written into the message, e.g. `@brand-kit/tone-of-voice`. */
  token: string;
  /** Last path segment without `.md`, for the menu row. */
  label: string;
}

/** One plugin or skill name flattened to something a `@token` can match. */
function slug(value: string): string {
  return (value || "skill")
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every skill mentionable from the user's stored plugins.
 *
 * Disabled plugins are left out: the switch in Settings is how a user says a
 * plugin should stop being applied, and honouring it here is the whole point of
 * having it. Manifests are parsed leniently — a row written by an older version
 * of the uploader must not break the menu.
 */
export function pluginSkillEntries(rows: PluginRow[]): PluginSkillEntry[] {
  const entries: PluginSkillEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.enabled) continue;
    let manifests: unknown = null;
    try {
      manifests = JSON.parse(row.manifests ?? "[]");
    } catch {
      continue;
    }
    if (!Array.isArray(manifests)) continue;

    const pluginSlug = slug(row.name);
    for (const raw of manifests) {
      if (!raw || typeof raw !== "object") continue;
      const manifest = raw as { path?: unknown; kind?: unknown };
      if (manifest.kind !== "skill" || typeof manifest.path !== "string") continue;
      const path = manifest.path;
      if (!/\.md$/i.test(path)) continue;

      const base = path.split("/").pop() ?? path;
      const label = base.replace(/\.md$/i, "");
      const token = `@${pluginSlug}/${slug(label)}`;
      if (seen.has(token)) continue;
      seen.add(token);

      entries.push({
        pluginId: row._id,
        pluginName: row.name,
        skillName: path,
        token,
        label,
      });
    }
  }

  return entries;
}

/**
 * The `@token` being typed at the caret, or null when the caret is elsewhere.
 *
 * Anchored to a word start so `someone@example.com` stays an email address
 * rather than opening a plugin menu.
 */
export function atTokenAt(
  text: string,
  caret: number,
): { token: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)(@[A-Za-z0-9_/-]*)$/);
  if (!match) return null;
  const token = match[2];
  return { token, start: before.length - token.length };
}

/**
 * Skills whose plugin or skill name matches the text after the `@`.
 *
 * The needle is split on the slash so `@brand/tone` narrows the plugin and the
 * skill independently — comparing the raw string against `plugin/skill` would
 * only ever match a fully typed mention.
 */
export function filterPluginSkills(
  entries: PluginSkillEntry[],
  token: string,
  limit = 8,
): PluginSkillEntry[] {
  const needle = token.replace(/^@/, "").toLowerCase();
  if (!needle) return entries.slice(0, limit);

  const [pluginNeedle, skillNeedle = ""] = needle.split("/");
  const scored: { entry: PluginSkillEntry; rank: number }[] = [];

  for (const entry of entries) {
    const pluginKey = slug(entry.pluginName);
    const skillKey = slug(entry.label);

    // A half-typed plugin name matches on either half; a typed slash means the
    // user has committed to a plugin and is narrowing its skills.
    const pluginHit = pluginNeedle !== "" && pluginKey.includes(pluginNeedle);
    const skillHit = needle.includes("/")
      ? skillNeedle !== "" && skillKey.includes(skillNeedle)
      : skillKey.includes(needle);
    if (!pluginHit && !(skillHit && !needle.includes("/"))) continue;
    if (needle.includes("/") && !skillHit) continue;

    const rank =
      (pluginKey === pluginNeedle ? 0 : pluginKey.startsWith(pluginNeedle) ? 1 : 2) +
      (skillNeedle === "" ? 0 : skillKey.startsWith(skillNeedle) ? 0 : 1);
    scored.push({ entry, rank });
  }

  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.entry);
}

/** One `@token` written in a message, with the skill it names, if any. */
export interface PluginMentionHit {
  /** The token exactly as typed, e.g. `@brand-kit/tone`. */
  token: string;
  /** The skill it resolves to, or null when no stored skill answers to it. */
  entry: PluginSkillEntry | null;
}

/**
 * Every `@token` in the draft, resolved.
 *
 * The composer shows the resolved ones as chips and the rest as a warning: a
 * mention of a plugin that has been removed is otherwise invisible until the
 * reply comes back without the skill applied.
 */
export function scanPluginMentions(
  text: string,
  entries: PluginSkillEntry[],
): PluginMentionHit[] {
  const byToken = new Map(entries.map((e) => [e.token.toLowerCase(), e]));
  const hits: PluginMentionHit[] = [];
  for (const match of text.matchAll(/(^|\s)@([A-Za-z0-9_/-]+)/g)) {
    const word = match[2] ?? "";
    hits.push({
      token: `@${word}`,
      entry: byToken.get(`@${word.toLowerCase()}`) ?? null,
    });
  }
  return hits;
}

/** Rewrite a draft with one `@token` mention taken out. */
export function removePluginMention(text: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`(^|\\s)${escaped}(?![A-Za-z0-9_/-])\\s?`), "$1")
    .trim();
}

/**
 * Pull `@plugin/skill` mentions out of a finished message.
 *
 * Returns the prompt with the mentions removed and the skills they named. An
 * `@` that matches no stored skill is left alone, so handles and email
 * addresses survive a send untouched.
 */
export function matchPluginMentions(
  text: string,
  entries: PluginSkillEntry[],
): { prompt: string; skills: { pluginId: string; skillName: string }[] } {
  const byToken = new Map(entries.map((e) => [e.token.toLowerCase(), e]));
  const skills: { pluginId: string; skillName: string }[] = [];

  const prompt = text
    .replace(/(^|\s)@([A-Za-z0-9_/-]+)\s?/g, (whole, lead: string, word: string) => {
      const hit = byToken.get(`@${word.toLowerCase()}`);
      if (!hit) return whole;
      if (!skills.some((s) => s.pluginId === hit.pluginId && s.skillName === hit.skillName)) {
        skills.push({ pluginId: hit.pluginId, skillName: hit.skillName });
      }
      return lead;
    })
    .trim();

  return { prompt, skills };
}
