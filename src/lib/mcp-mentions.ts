// ---------------------------------------------------------------------------
// `$server` mentions in the composer.
//
// Typing `$` opens the list of the user's MCP servers; picking one writes
// `$name` into the message. On send those tokens are removed from the prompt
// and resolved back to server ids, which the server passes to the AI action so
// *only* those servers' tools are attached to that turn.
//
// The mention is deliberately inert text until send: a `$` in a half-typed
// message must never trigger a network call on its own.
// ---------------------------------------------------------------------------

/** The fields of an MCP server row this module needs. */
export interface McpMentionServer {
  _id: string;
  name: string;
  prefix?: string | null;
  toolCount?: number | null;
}

/** The word a server is mentioned by: lowercase, punctuation collapsed. */
export function mcpSlug(name: string): string {
  return (name || "mcp").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

/**
 * The `$token` being typed at the caret, or null when the caret is elsewhere.
 *
 * Only a `$` at the start of the message or after whitespace counts, so
 * `cost $5` inside a sentence is prose rather than a mention.
 */
export function dollarTokenAt(
  text: string,
  caret: number,
): { token: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)(\$[A-Za-z0-9_-]*)$/);
  if (!match) return null;
  const token = match[2];
  // "$5" is money, not a mention — and a menu popping up over a price is
  // exactly the kind of noise that makes an inline trigger annoying.
  if (/^\$\d/.test(token)) return null;
  return { token, start: before.length - token.length };
}

/** Servers whose name or slug matches the text after the `$`. */
export function filterMcpServers(
  servers: McpMentionServer[],
  token: string,
  limit = 8,
): McpMentionServer[] {
  const needle = token.replace(/^\$/, "").toLowerCase();
  if (!needle) return servers.slice(0, limit);
  const scored: { server: McpMentionServer; rank: number }[] = [];
  for (const server of servers) {
    const keys = [mcpSlug(server.name), (server.prefix ?? "").toLowerCase()];
    let rank = Number.POSITIVE_INFINITY;
    for (const key of keys) {
      if (!key) continue;
      if (key === needle) rank = Math.min(rank, 0);
      else if (key.startsWith(needle)) rank = Math.min(rank, 1);
      else if (key.includes(needle)) rank = Math.min(rank, 2);
    }
    if (Number.isFinite(rank)) scored.push({ server, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((s) => s.server);
}

/**
 * Pull `$server` mentions out of a finished message.
 *
 * Returns the prompt with the mentions removed and the ids they pointed at. A
 * token that matches no server is left alone: it may be money, a LaTeX
 * delimiter, or just prose, and silently eating it would corrupt the message.
 */
export function matchMcpMentions(
  text: string,
  servers: McpMentionServer[],
): { prompt: string; serverIds: string[] } {
  const byKey = new Map<string, string>();
  for (const server of servers) {
    byKey.set(mcpSlug(server.name), server._id);
    const prefix = (server.prefix ?? "").toLowerCase();
    if (prefix) byKey.set(prefix, server._id);
  }

  const serverIds: string[] = [];
  const prompt = text
    .replace(/(^|\s)\$([A-Za-z0-9_-]+)\s?/g, (whole, lead: string, word: string) => {
      const id = byKey.get(word.toLowerCase());
      if (!id) return whole;
      if (!serverIds.includes(id)) serverIds.push(id);
      return lead;
    })
    .trim();

  return { prompt, serverIds };
}
