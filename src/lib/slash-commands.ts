// ---------------------------------------------------------------------------
// Slash commands.
//
// One table, three consumers: the composer's autocomplete menu, the Enter key,
// and the placeholder hint. Previously these were four separate regexes in the
// send handler plus a hardcoded grid of quick actions, so a command could exist
// in one place and be missing from the other.
//
// A command here is descriptive only. What it *does* lives in the Dashboard,
// because every one of them needs state the composer does not own. The point of
// the table is that the menu can never offer something the parser does not
// recognise, and the parser can never accept something the menu does not show.
// ---------------------------------------------------------------------------

import { LOCAL_TOOLS } from "./local-tools";
import { PROMPT_TEMPLATES } from "./prompt-templates";

export type SlashGroup =
  | "World"
  | "Code"
  | "Write"
  | "Create"
  | "Think"
  | "Math"
  | "Tools"
  | "Session";

export interface SlashCommand {
  /** Canonical name, matched case-insensitively. */
  name: string;
  /** Other spellings that reach the same handler. */
  aliases: string[];
  group: SlashGroup;
  summary: string;
  /** Shown after the command in the composer, e.g. "<city>". */
  argHint?: string;
  /** A ready-made example, inserted when the command is chosen with no args. */
  example: string;
  /**
   * True when the command does nothing without an argument. Entering
   * `/weather` with no city is almost certainly a mistake, so it should not
   * fall through to sending the literal text as a chat message.
   */
  needsArg?: boolean;
  /**
   * Present on the commands that are a job rather than a destination: the
   * returned text is what gets sent. Absent commands are handled in Dashboard
   * by name because they need state the table cannot see.
   */
  buildPrompt?: (args: string) => string;
}

/** Commands with their own handler in the Dashboard. */
const CORE_COMMANDS: SlashCommand[] = [
  {
    name: "time",
    aliases: [],
    group: "World",
    summary: "Current time in a city or IANA timezone",
    argHint: "<city or zone>",
    example: "/time Asia/Tokyo",
    needsArg: true,
  },
  {
    name: "weather",
    aliases: ["w"],
    group: "World",
    summary: "Live conditions and forecast for a city",
    argHint: "<city>",
    example: "/weather London",
    needsArg: true,
  },
  {
    name: "currency",
    aliases: [],
    group: "World",
    summary: "Convert an amount between currencies",
    argHint: "<amount> <from> to <to>",
    example: "/currency 100 USD to EUR",
    needsArg: true,
  },
  {
    name: "country",
    aliases: [],
    group: "World",
    summary: "Facts, population and currency for a country",
    argHint: "<country>",
    example: "/country Japan",
    needsArg: true,
  },
  {
    name: "movie",
    aliases: ["film", "imdb"],
    group: "World",
    summary: "Film or series details from OMDb",
    argHint: "<title>",
    example: "/movie Interstellar",
    needsArg: true,
  },
  {
    name: "nasa",
    aliases: ["space"],
    group: "World",
    summary: "NASA's picture of the day, with an EPIC fallback",
    example: "/nasa",
  },
  {
    name: "isro",
    aliases: ["launches"],
    group: "World",
    summary: "Upcoming ISRO launches",
    example: "/isro",
  },
  {
    name: "news",
    aliases: [],
    group: "World",
    summary: "Current headlines, optionally about a topic",
    argHint: "<topic>",
    example: "/news artificial intelligence",
  },
  {
    name: "image",
    aliases: ["img", "draw"],
    group: "Create",
    summary: "Generate an image from a description",
    argHint: "<description>",
    example: "/image a neon city in the rain",
    needsArg: true,
  },
  {
    name: "plot",
    aliases: ["graph"],
    group: "Math",
    summary: "Interactive Desmos graph of an expression",
    argHint: "<y = x^2>",
    example: "/plot y = x^2",
    needsArg: true,
  },
  {
    name: "solve",
    aliases: ["math"],
    group: "Math",
    summary: "Step-by-step worked solution with LaTeX",
    argHint: "<problem>",
    example: "/solve integrate x^2 sin(x) dx",
    needsArg: true,
  },
  {
    name: "github",
    aliases: ["repo"],
    group: "Code",
    summary: "A GitHub repository at a glance, README included",
    argHint: "<owner/repo>",
    example: "/github convex-dev/convex",
    needsArg: true,
  },
  {
    name: "research",
    aliases: [],
    group: "World",
    summary: "Deep Research: search the live web, then synthesise",
    argHint: "<question>",
    example: "/research state of solid-state batteries",
  },
  {
    name: "listen",
    aliases: [],
    group: "Session",
    summary: "Read this conversation aloud from the composer",
    example: "/listen",
  },
  {
    name: "recap",
    aliases: ["tldr", "digest"],
    group: "Session",
    summary: "Where this conversation stands: decided, open, next",
    example: "/recap",
  },
  {
    name: "verify",
    aliases: ["review", "audit"],
    group: "Session",
    summary: "A second engine audits the last answer",
    example: "/verify",
  },
  {
    name: "pinned",
    aliases: ["pins"],
    group: "Session",
    summary: "Open pinned messages from across every chat",
    example: "/pinned",
  },
  {
    name: "agent",
    aliases: ["run"],
    group: "Session",
    summary: "Hand a task to the agent: it plans, works and verifies",
    argHint: "<task>",
    // No argument is a valid use: bare `/agent` arms the mode so the task can
    // be typed next, which is how the pill works too.
    example: "/agent Add tests for the pricing module",
  },
  {
    name: "export",
    aliases: [],
    group: "Session",
    summary: "Export this conversation",
    example: "/export",
  },
  {
    name: "stats",
    aliases: ["statistics"],
    group: "Session",
    summary: "Conversation stats — messages, tokens, engines, ratings",
    example: "/stats",
  },
  {
    name: "studio",
    aliases: ["art"],
    group: "Create",
    summary: "Image Studio — styles, models and shapes before you render",
    example: "/studio",
  },
  {
    name: "find",
    aliases: ["search"],
    group: "Session",
    summary: "Find text in this conversation and jump between matches",
    argHint: "<text>",
    example: "/find invoice",
  },
  {
    name: "new",
    aliases: [],
    group: "Session",
    summary: "Start a fresh conversation",
    example: "/new",
  },
  {
    name: "mcp",
    aliases: ["servers"],
    group: "Session",
    summary: "MCP servers — add one, or test the connection",
    example: "/mcp",
  },
  {
    name: "plugins",
    aliases: ["skills"],
    group: "Session",
    summary: "Plugin zips and the skills they carry",
    example: "/plugins",
  },
];

/**
 * The workflow commands, generated from the template table so a prompt can
 * never exist without a menu entry (or the other way round).
 */
const PROMPT_COMMANDS: SlashCommand[] = Object.entries(PROMPT_TEMPLATES).map(
  ([name, template]) => ({
    name,
    aliases: template.aliases,
    group: template.group,
    summary: template.summary,
    ...(template.argHint ? { argHint: template.argHint } : {}),
    example: template.example,
    buildPrompt: template.build,
  }),
);

/**
 * The exact ones — no model involved, so they work with every engine down and
 * return in a millisecond. Grouped last before Session in the menu.
 */
const TOOL_COMMANDS: SlashCommand[] = Object.entries(LOCAL_TOOLS).map(
  ([name, tool]) => ({
    name,
    aliases: tool.aliases,
    group: "Tools" as const,
    summary: tool.summary,
    ...(tool.argHint ? { argHint: tool.argHint } : {}),
    example: tool.example,
    ...(tool.needsArg ? { needsArg: true } : {}),
  }),
);

export const SLASH_COMMANDS: SlashCommand[] = [
  ...CORE_COMMANDS,
  ...PROMPT_COMMANDS,
  ...TOOL_COMMANDS,
];

export interface SlashMatch {
  command: SlashCommand;
  /** Everything after the command name, trimmed. */
  args: string;
}

/** The command a piece of text invokes, or null when it is ordinary prose. */
export function matchSlashCommand(text: string): SlashMatch | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  // Names may carry digits — /base64 and /el5 are commands too.
  const match = trimmed.match(/^\/([a-z][a-z0-9]*)\s*([\s\S]*)$/i);
  if (!match) return null;
  const [, name, rest] = match;
  const command = SLASH_COMMANDS.find(
    (c) => c.name === name.toLowerCase() || c.aliases.includes(name.toLowerCase()),
  );
  if (!command) return null;
  return { command, args: rest.trim() };
}

/**
 * The commands that should appear as the user types a slash.
 *
 * Ranked so that an exact prefix beats a mid-string alias match: typing `/we`
 * should surface `/weather` first, not `/week`-style near-misses from aliases.
 */
export function filterSlashCommands(token: string, limit = 8): SlashCommand[] {
  const needle = token.replace(/^\//, "").trim().toLowerCase();
  if (!needle) return SLASH_COMMANDS.slice(0, limit);

  const scored: { command: SlashCommand; rank: number }[] = [];
  for (const command of SLASH_COMMANDS) {
    const names = [command.name, ...command.aliases];
    let rank = Number.POSITIVE_INFINITY;
    names.forEach((n, index) => {
      // An alias match is worth less than a name match, hence +1.
      const base = index === 0 ? 0 : 1;
      if (n === needle) rank = Math.min(rank, base);
      else if (n.startsWith(needle)) rank = Math.min(rank, base + 2);
      else if (n.includes(needle)) rank = Math.min(rank, base + 3);
    });
    if (Number.isFinite(rank)) scored.push({ command, rank });
  }

  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.command);
}

/** The trailing `/token` in the composer, or null when the cursor is not in one. */
export function slashTokenAt(
  text: string,
  caret: number,
): { token: string; start: number } | null {
  const before = text.slice(0, caret);
  // Only a slash at the very start of the message counts: "/path/to" inside a
  // sentence is prose, and hijacking it would be worse than no menu.
  if (!before.startsWith("/")) return null;
  if (/\s/.test(before)) return null;
  const match = before.match(/^\/[^\s]*$/);
  if (!match) return null;
  return { token: match[0], start: 0 };
}

/** Menu order, so the grouped view and the keyboard agree on row numbers. */
export const SLASH_GROUP_ORDER: SlashGroup[] = [
  "World",
  "Code",
  "Write",
  "Create",
  "Think",
  "Math",
  "Tools",
  "Session",
];

/** Subsequence match, so `/wt` still finds `/weather`. */
export function slashMatches(command: SlashCommand, needle: string): boolean {
  const names = [command.name, ...command.aliases];
  return names.some((name) => {
    let i = 0;
    for (const ch of name) {
      if (ch === needle[i]) i += 1;
      if (i === needle.length) return true;
    }
    return needle.length === 0;
  });
}

/**
 * The menu's rows, flattened.
 *
 * The keydown handler and the menu must agree on what row N is; with forty
 * commands a mismatch meant Enter could run a different command than the one
 * highlighted. Both now read this one list.
 */
export function slashMenuCommands(token: string): SlashCommand[] {
  const needle = token.replace(/^\//, "").toLowerCase();
  const matching = SLASH_COMMANDS.filter((c) => slashMatches(c, needle));
  return SLASH_GROUP_ORDER.flatMap((group) =>
    matching.filter((c) => c.group === group),
  );
}

/** The hint shown in the composer placeholder. */
export function slashHint(): string {
  return SLASH_COMMANDS.map((c) => `/${c.name}`).join("  ");
}