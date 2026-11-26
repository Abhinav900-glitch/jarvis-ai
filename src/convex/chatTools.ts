// ---------------------------------------------------------------------------
// Chat tools (built-in functions that Jarvis can call through the chat loop).
// This file is the single registry for those tools: each tool is declared here
// so the dispatcher and the UI can both ask "what can Jarvis do right now" and
// get the same answer without one side drifting.
// ---------------------------------------------------------------------------

import { GHOST_OTP_TOOL } from "./ghostChatTool";
import type { ToolSpec } from "./ai";
import { LM_STUDIO_KEY_ENVS, readEnv } from "./imageProviders";

export { GHOST_OTP_TOOL };

export { GHOST_OTP_PROMPT } from "./ghostChatTool";
export { readGhostOtp, wantsGhostOtp } from "./ghostChatTool";

export const CHAT_TOOLS: ToolSpec[] = [
  GHOST_OTP_TOOL,
];

/**
 * Whether the LM Studio / local model provider is wired in for chat.
 *
 * Availability is the base URL plus either the explicit base URL or a local
 * key — the intent being that `LM_STUDIO_BASE_URL` is the real surface and the
 * key is optional for the default LM Studio setup.
 */
export function lmStudioWiredIn(): boolean {
  const base = process.env.LM_STUDIO_BASE_URL?.trim() ?? "";
  const key = readEnv(LM_STUDIO_KEY_ENVS);
  return Boolean(base || key);
}

/**
 * The base URL for the local OpenAI-compatible server, if one is set.
 *
 * Public for the chat-tool dispatcher and any LM Studio-specific tooling,
 * so the same base URL the engine registry uses can also be surfaced to the
 * recipient when the provider is wired in.
 */
export function lmStudioBaseUrl(): string | null {
  const base = process.env.LM_STUDIO_BASE_URL?.trim() ?? "";
  if (!base) return null;
  try {
    const url = new URL(base);
    if (!url.protocol.startsWith("http")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
