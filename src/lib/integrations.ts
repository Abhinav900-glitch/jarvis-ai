// ---------------------------------------------------------------------------
// Integrations directory.
//
// The Integrations menu is the app-store view of what Jarvis can reach. It has
// two halves:
//
//   1. Built-in reach — capabilities compiled into the app (voice, images,
//      memory, code, scheduling). These are always live; the card just opens
//      the panel that controls them.
//   2. Connected accounts — third-party services, which come from the MCP
//      preset catalogue in src/lib/mcp-presets.ts. Only endpoints that were
//      probed and answered are listed there, so every card here is a real
//      account you can connect rather than a logo wall.
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
 * The newest additions to the app, shown as their own section so a returning
 * user can see what changed without reading a changelog elsewhere.
 *
 * These are the features that shipped most recently and are already live — an
 * entry belongs here only while it is actually new, and it points at the panel
 * that exercises it so the card is a route, not an announcement.
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
}

export const RECENT_FEATURES: RecentFeature[] = [
  {
    id: "web-search-tool",
    name: "Web search tool",
    blurb:
      "The assistant searches live sources itself before answering, and cites the pages it used.",
    where: "in chat, automatically",
  },
  {
    id: "connector-skills",
    name: "Skills from connectors",
    blurb:
      "Every connected account is listed as a skill, so its tools are visible before you ask.",
    panel: "mcp",
    where: "Settings → Integrations",
  },
  {
    id: "copy-and-preview",
    name: "Copy and preview results",
    blurb:
      "Tool results open in a viewer: copy the whole output, or preview a generated page before editing it.",
    panel: "code",
    where: "tool result viewer",
  },
  {
    id: "connector-directory",
    name: "Connector directory",
    blurb:
      "Searchable catalogue of verified endpoints, with one-click connect or an inline key form.",
    panel: "mcp",
    where: "Settings → Integrations",
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
