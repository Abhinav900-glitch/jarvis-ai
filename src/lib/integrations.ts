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
