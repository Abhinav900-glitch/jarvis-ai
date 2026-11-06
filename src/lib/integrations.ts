// ---------------------------------------------------------------------------
// Integrations directory.
//
// The Integrations menu is the app-store view of what Jarvis can reach. It has
// three parts:
//
//   1. Features — the inventory of what this build does, newest first.
//   2. Built-in reach — capabilities compiled into the app (voice, images,
//      memory, code, scheduling). These are always live; the card just opens
//      the panel that controls them.
//   3. Connectors — third-party services, which come from the MCP preset
//      catalogue in src/lib/mcp-presets.ts. Only endpoints that were probed and
//      answered are listed there, so every card here is a real account you can
//      connect rather than a logo wall.
//
// Nothing in this file invents a provider: a panel id below must exist in
// src/pages/Dashboard.tsx, and an app card must have a matching preset.
// ---------------------------------------------------------------------------

/** Panels the Integrations menu can route into. Each one is a real toggle in Dashboard. */
export type IntegrationPanel =
  | "mcp"
  | "plugins"
  | "voices"
  | "studio"
  | "code"
  | "memory"
  | "calculator"
  | "translate"
  | "tasks"
  | "sounds"
  | "live";

export interface BuiltInIntegration {
  id: string;
  name: string;
  /** One line for the card. */
  blurb: string;
  /** What the assistant gains from it. */
  gain: string;
  /** Panel that configures it. */
  panel: IntegrationPanel;
  /**
   * Whether it works with no setup at all. Two entries are false: Canva and
   * Cloudinary, which need the account linked from the MCP panel first.
   */
  defaultOn: boolean;
}

/**
 * One entry in the feature inventory, ordered newest first.
 *
 * Every entry names something that exists in this build and states where the
 * user meets it, so the section doubles as a map of the app. `fresh` marks the
 * handful that shipped most recently; everything else is established and is
 * only listed once the section is expanded.
 */
export interface RecentFeature {
  id: string;
  name: string;
  /** One line for the card. */
  blurb: string;
  /** Panel that shows the feature, when one exists. */
  panel?: IntegrationPanel;
  /** Where the feature is used, for the card's footer line. */
  where: string;
  /** True for the newest handful, which carry a "new" chip. */
  fresh?: boolean;
}

export const RECENT_FEATURES: RecentFeature[] = [
  {
    id: "web-search-tool",
    name: "Web search tool",
    blurb:
      "The assistant searches live sources itself before answering, and cites the pages it used.",
    where: "in chat, automatically",
    fresh: true,
  },
  {
    id: "connector-skills",
    name: "Skills from connectors",
    blurb:
      "Every connected account is listed as a skill, so its tools are visible before you ask.",
    panel: "mcp",
    where: "Settings → Integrations",
    fresh: true,
  },
  {
    id: "copy-and-preview",
    name: "Copy and preview results",
    blurb:
      "Tool results open in a viewer: copy the whole output, or preview a generated page before editing it.",
    panel: "code",
    where: "tool result viewer",
    fresh: true,
  },
  {
    id: "connector-directory",
    name: "Connector directory",
    blurb:
      "Searchable catalogue of verified endpoints, with one-click connect or an inline key form.",
    panel: "mcp",
    where: "Settings → Integrations",
    fresh: true,
  },
  {
    id: "deep-research",
    name: "Deep research",
    blurb:
      "Searches the live web, reads the pages, then synthesises an answer with numbered citations.",
    where: "/research",
  },
  {
    id: "agent-mode",
    name: "Agent mode",
    blurb:
      "Hand over a whole task: the agent plans, edits files, runs commands and verifies the result.",
    panel: "code",
    where: "/agent",
  },
  {
    id: "answer-audit",
    name: "Answer audit",
    blurb:
      "A second engine re-reads the last answer and flags what it cannot stand behind.",
    where: "/verify",
  },
  {
    id: "long-term-memory",
    name: "Long-term memory",
    blurb:
      "Facts worth keeping are extracted and recalled in later chats. You can read and forget them.",
    panel: "memory",
    where: "Settings → Memory",
  },
  {
    id: "engine-routing",
    name: "Engine routing",
    blurb:
      "Every turn is scored and sent to the engine best suited to it, with automatic retry on failure.",
    where: "engine panel",
  },
  {
    id: "projects",
    name: "Projects",
    blurb:
      "Chats grouped into a project, with its own instructions and files shared across the group.",
    where: "project sidebar",
  },
  {
    id: "branches",
    name: "Branch and compare",
    blurb:
      "Fork a conversation from any message and diff two branches instead of losing the original.",
    where: "branch bar",
  },
  {
    id: "recap",
    name: "Conversation recap",
    blurb:
      "Where this chat stands: what was decided, what is still open, and what comes next.",
    where: "/recap",
  },
  {
    id: "session-stats",
    name: "Session stats",
    blurb:
      "Messages, tokens, engines used and ratings for the conversation, in one readout.",
    where: "/stats",
  },
  {
    id: "export",
    name: "Conversation export",
    blurb:
      "Take a chat out as Markdown or JSON, with models and attachments noted per message.",
    where: "/export",
  },
  {
    id: "pins",
    name: "Pinned messages",
    blurb:
      "Pin an answer in any chat and find every pin again from one list.",
    where: "/pinned",
  },
  {
    id: "prompt-templates",
    name: "Prompt templates",
    blurb:
      "Ready-made instructions for proofreading, summarising, explaining and reviewing code.",
    where: "slash menu",
  },
  {
    id: "command-palette",
    name: "Command palette",
    blurb:
      "Every action in one keyboard-first list, plus shortcuts for the panels you use most.",
    where: "⌘K",
  },
  {
    id: "image-studio",
    name: "Image studio",
    blurb:
      "Pick a style, model and shape before rendering, then remix or download the result.",
    panel: "studio",
    where: "Settings → Image studio",
  },
  {
    id: "graphing",
    name: "Graphing calculator",
    blurb:
      "An interactive Desmos graph for any expression, drawn inside the chat.",
    panel: "calculator",
    where: "Settings → Math",
  },
  {
    id: "math-solver",
    name: "Step-by-step math",
    blurb:
      "Worked solutions with LaTeX, not just the final number.",
    panel: "calculator",
    where: "/solve",
  },
  {
    id: "code-runner",
    name: "Code runner",
    blurb:
      "Runs JavaScript, Python and more in a sandbox and shows stdout, stderr and exit code.",
    panel: "code",
    where: "Settings → Code runner",
  },
  {
    id: "translation",
    name: "Translation",
    blurb:
      "Translate a message or ask for replies in another language, sentence by sentence.",
    panel: "translate",
    where: "Settings → Translation",
  },
  {
    id: "speech",
    name: "Voices",
    blurb:
      "Spoken replies with a voice you pick and can preview before committing to it.",
    panel: "voices",
    where: "Settings → Voices",
  },
  {
    id: "live-voice",
    name: "Live voice",
    blurb:
      "Hands-free conversation that follows the room's mood and answers aloud.",
    panel: "live",
    where: "Settings → Live voice",
  },
  {
    id: "wake-word",
    name: "Wake word",
    blurb:
      "Say “Hey Jarvis” and only what follows is treated as a command.",
    where: "live mode",
  },
  {
    id: "gestures",
    name: "Gesture control",
    blurb:
      "A held hand gesture triggers one deliberate action — never four from a flicker.",
    where: "camera",
  },
  {
    id: "scheduled-tasks",
    name: "Scheduled tasks",
    blurb:
      "Prompts that run on a timer without you: digests, checks and reminders.",
    panel: "tasks",
    where: "Settings → Scheduled tasks",
  },
  {
    id: "plugins",
    name: "Plugins and skills",
    blurb:
      "Drop in a zip of Markdown skills and mention any of them in the composer with @.",
    panel: "plugins",
    where: "Settings → Plugins",
  },
  {
    id: "github-lookup",
    name: "Repository lookups",
    blurb:
      "Any public repository at a glance, README included, without leaving the chat.",
    where: "/github",
  },
  {
    id: "sound-cues",
    name: "Sound cues",
    blurb:
      "A short cue when a request lands or finishes, so you can look away.",
    panel: "sounds",
    where: "Settings → Sounds",
  },
];

export const BUILT_IN_INTEGRATIONS: BuiltInIntegration[] = [
  {
    id: "voice-out",
    name: "Speech",
    blurb: "Jarvis talks back with the voice you pick.",
    gain: "spoken replies, voice previews",
    panel: "voices",
    defaultOn: true,
  },
  {
    id: "images",
    name: "Image studio",
    blurb: "Generate and edit pictures from a prompt.",
    gain: "image generation, remix, download",
    panel: "studio",
    defaultOn: true,
  },
  {
    id: "code-runner",
    name: "Code runner",
    blurb: "Runs snippets in a sandbox and shows the output.",
    gain: "execute code, capture stdout",
    panel: "code",
    defaultOn: true,
  },
  {
    id: "memory",
    name: "Memory",
    blurb: "Facts and preferences that survive a new chat.",
    gain: "recall across sessions",
    panel: "memory",
    defaultOn: true,
  },
  {
    id: "math",
    name: "Math engine",
    blurb: "Exact arithmetic and Desmos-style graphing.",
    gain: "solved expressions, plots",
    panel: "calculator",
    defaultOn: true,
  },
  {
    id: "translate",
    name: "Translation",
    blurb: "Translate text and replies between languages.",
    gain: "bilingual replies",
    panel: "translate",
    defaultOn: true,
  },
  {
    id: "plugins",
    name: "Plugins",
    blurb: "Skill packs that teach new workflows as zips.",
    gain: "installed skills, slash commands",
    panel: "plugins",
    defaultOn: true,
  },
  {
    id: "tasks",
    name: "Scheduled tasks",
    blurb: "Prompts that run on a timer without you.",
    gain: "recurring jobs, digests",
    panel: "tasks",
    defaultOn: true,
  },
  {
    id: "sounds",
    name: "Sound cues",
    blurb: "A short cue when a request lands or finishes.",
    gain: "audio feedback",
    panel: "sounds",
    defaultOn: true,
  },
  {
    id: "live",
    name: "Live voice",
    blurb: "Two-way conversation instead of push-to-talk.",
    gain: "hands-free sessions",
    panel: "live",
    defaultOn: true,
  },
  {
    id: "canva",
    name: "Canva",
    blurb: "Designs and exports through your Canva account.",
    gain: "create designs, export images",
    panel: "mcp",
    defaultOn: false,
  },
  {
    id: "cloudinary",
    name: "Cloudinary",
    blurb: "Hosts and transforms the images the app makes.",
    gain: "image upload, delivery URLs",
    panel: "mcp",
    defaultOn: false,
  },
];
