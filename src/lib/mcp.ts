// ---------------------------------------------------------------------------
// MCP (Model Context Protocol) client — Streamable HTTP transport.
//
// This is what lets the assistant reach Canva and any other MCP server. It is
// deliberately hand-rolled on top of `fetch` rather than pulling in the MCP
// SDK: the part of the protocol we need is four JSON-RPC methods (initialize,
// notifications/initialized, tools/list, tools/call) over a single POST
// endpoint, and keeping it dependency-free means it runs in Convex's Node
// runtime with nothing extra to install.
//
// A server speaks JSON-RPC 2.0 over one HTTP endpoint. Each request is a POST
// that answers with either `application/json` (one response) or
// `text/event-stream` (the response arrives on a `data:` line). After
// `initialize` the server may hand back a session id that every later request
// must echo, so the session is carried on the client instance.
//
// Tool schemas from `tools/list` are already JSON Schema, which is exactly the
// shape OpenAI function tools take, so conversion is a rename + a defensive
// default rather than a translation.
// ---------------------------------------------------------------------------

import type { ToolSpec } from "../convex/ai";

/** MCP protocol revision we speak. Servers negotiate down if they prefer. */
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_CONNECT_TIMEOUT_MS = 20_000;
const MCP_CALL_TIMEOUT_MS = 60_000;
const MCP_MAX_TOOL_PAGES = 20;
const MCP_NAME_MAX = 64;

/** How a single MCP server is reached: an endpoint plus auth headers. */
export interface McpServerConfig {
  /** Stable identifier, e.g. "canva". */
  id: string;
  /** Prefix prepended to tool names so servers cannot collide. */
  prefix: string;
  url: string;
  headers: Record<string, string>;
}

/** One tool as the server advertises it. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

// Monotonic request ids — enough to correlate a streamed response with the
// request that asked for it, and never reused within a process.
let rpcCounter = 1;

/**
 * Read one JSON-RPC response out of an SSE body.
 *
 * Proper SSE framing: events are separated by blank lines, and an event's
 * `data:` lines concatenate with newlines. We return as soon as the response
 * matching `expectedId` appears, so a server that keeps the stream open for
 * keep-alives does not hold the request hostage.
 */
async function readSseRpc(
  res: Response,
  expectedId: number | null,
): Promise<JsonRpcMessage | null> {
  const body = res.body;
  if (!body) return null;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const flushEvent = (): JsonRpcMessage | null => {
    if (dataLines.length === 0) return null;
    const payload = dataLines.join("\n");
    dataLines = [];
    try {
      const msg = JSON.parse(payload) as JsonRpcMessage;
      if (expectedId === null) return msg;
      return msg.id === expectedId ? msg : null;
    } catch {
      return null;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line === "") {
          const msg = flushEvent();
          if (msg) return msg;
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        // Comments (`: keep-alive`) and event:/id:/retry: fields are ignored.
      }
    }
    // A stream that ended without a closing blank line leaves a pending event.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) dataLines.push(tail.slice(5).replace(/^ /, ""));
    return flushEvent();
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed.
    }
  }
}

/** Flatten an MCP `content` array (plus optional structuredContent) to text. */
function mcpContentToString(content: unknown, structured: unknown): string {
  if (Array.isArray(content) && content.length > 0) {
    return content
      .map((raw) => {
        if (raw && typeof raw === "object") {
          const b = raw as {
            type?: string;
            text?: string;
            mimeType?: string;
            resource?: { text?: string; uri?: string };
          };
          if (b.type === "text" && typeof b.text === "string") return b.text;
          if (b.type === "image") return `[image${b.mimeType ? ` ${b.mimeType}` : ""}]`;
          if (b.type === "resource" && b.resource?.text) return b.resource.text;
          if (b.type === "resource" && b.resource?.uri)
            return `[resource ${b.resource.uri}]`;
          return `[${b.type ?? "content"}]`;
        }
        return typeof raw === "string" ? raw : JSON.stringify(raw);
      })
      .join("\n");
  }
  if (structured !== undefined && structured !== null) {
    return typeof structured === "string" ? structured : JSON.stringify(structured);
  }
  return "";
}

/**
 * A connection to one MCP server.
 *
 * One instance holds the session across `listTools`/`callTool` so a chat turn
 * that calls three Canva tools does not re-initialize three times. Convex
 * actions are request-scoped, so callers create a client, use it, and
 * `close()` it in a `finally` — there is no module-level connection to leak.
 */
export class McpClient {
  private sessionId: string | null = null;
  private connected = false;
  private readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(url: string, headers: Record<string, string>) {
    this.url = url;
    this.headers = headers;
  }

  private async post(
    body: Record<string, unknown>,
    expectedId: number | null,
    timeoutMs: number,
  ): Promise<JsonRpcMessage | null> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...this.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const sid = res.headers.get("Mcp-Session-Id");
    if (sid) this.sessionId = sid;

    // Notifications are acknowledged with 202 and no body.
    if (res.status === 202) return null;
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `MCP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      );
    }

    const contentType = res.headers.get("Content-Type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return await readSseRpc(res, expectedId);
    }
    return (await res.json()) as JsonRpcMessage;
  }

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const id = rpcCounter++;
    const msg = await this.post(
      { jsonrpc: "2.0", id, method, params },
      id,
      MCP_CALL_TIMEOUT_MS,
    );
    if (!msg) throw new Error(`MCP ${method}: empty response`);
    if (msg.error) throw new Error(msg.error.message || `MCP ${method} failed`);
    return msg.result;
  }

  private async notify(method: string): Promise<void> {
    try {
      await this.post({ jsonrpc: "2.0", method }, null, MCP_CONNECT_TIMEOUT_MS);
    } catch {
      // Best-effort: a server that rejects the notification is still usable.
    }
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    const id = rpcCounter++;
    const msg = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "Freebuff", version: "1.0.0" },
        },
      },
      id,
      MCP_CONNECT_TIMEOUT_MS,
    );
    if (!msg) throw new Error("MCP initialize: empty response");
    if (msg.error)
      throw new Error(msg.error.message || "MCP initialize failed");
    this.connected = true;
    await this.notify("notifications/initialized");
  }

  /** List every tool the server exposes, following cursor pagination. */
  async listTools(): Promise<McpTool[]> {
    await this.connect();
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MCP_MAX_TOOL_PAGES; page++) {
      const result = (await this.rpc(
        "tools/list",
        cursor ? { cursor } : {},
      )) as { tools?: unknown[]; nextCursor?: string } | undefined;
      for (const raw of result?.tools ?? []) {
        const t = raw as {
          name?: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        };
        if (t && typeof t.name === "string" && t.name) {
          tools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          });
        }
      }
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  /** Call one tool by its server-side name. Never throws for a tool error. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: string; isError: boolean }> {
    await this.connect();
    const result = (await this.rpc("tools/call", {
      name,
      arguments: args,
    })) as
      | { content?: unknown[]; isError?: boolean; structuredContent?: unknown }
      | undefined;
    return {
      content: mcpContentToString(result?.content, result?.structuredContent),
      isError: Boolean(result?.isError),
    };
  }

  /** End the session. Safe to call more than once. */
  async close(): Promise<void> {
    const sid = this.sessionId;
    this.sessionId = null;
    this.connected = false;
    if (!sid) return;
    try {
      await fetch(this.url, {
        method: "DELETE",
        headers: { ...this.headers, "Mcp-Session-Id": sid },
        signal: AbortSignal.timeout(MCP_CONNECT_TIMEOUT_MS),
      });
    } catch {
      // The session ends with the request regardless.
    }
  }
}

/**
 * A tool name that is safe to hand a model.
 *
 * Providers reject function names outside `[a-zA-Z0-9_-]{1,64}`, and several
 * servers use names with spaces or slashes. The prefix both namespaces the
 * tool (`canva__create_design`) and lets a dispatch map recover which server a
 * call belongs to.
 */
export function sanitizeMcpToolName(prefix: string, name: string): string {
  return `${prefix}__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MCP_NAME_MAX);
}

/** Wrap one MCP tool as an OpenAI function spec the model can call. */
export function mcpToolToSpec(tool: McpTool, prefix: string): ToolSpec {
  return {
    type: "function",
    function: {
      name: sanitizeMcpToolName(prefix, tool.name),
      description:
        tool.description?.trim() ||
        `Call the ${tool.name} tool from the ${prefix} integration.`,
      parameters: normalizeSchema(tool.inputSchema),
    },
  };
}

function normalizeSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  return schema.type ? schema : { type: "object", ...schema };
}
