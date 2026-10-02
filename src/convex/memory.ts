"use node";

import { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { type Id, type DataModel } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";

/** Minimal structural type so this helper works from any action context. */
type QueryRunner = Pick<GenericActionCtx<DataModel>, "runQuery" | "runAction">;

const MAX_CONTEXT_ITEMS = 12;
const MAX_EXTRACT = 5;

const MEMORY_SYSTEM_PROMPT = `You maintain a small, long-term memory store for a personal AI assistant.

From the single user/assistant exchange below, decide whether there is anything worth remembering across sessions.

Only record durable things, such as:
- stated personal facts ("I live in Bengaluru", "my daughter is 4")
- explicit preferences ("keep replies short", "I use Linux not macOS")
- ongoing projects or commitments ("shipping a Vite app next month")
- constraints that will change future answers

Do NOT record:
- one-off questions, small talk, greetings, or anything the assistant said about itself
- anything already implied by the current message
- secrets, passwords, API keys, card numbers or card numbers of any kind

Return STRICT JSON only, in this exact shape:
{"memories":[{"content":"...","kind":"preference|fact|context"}]}

Each "content" must be a single self-contained sentence (under 140 characters) written in third person, e.g. "The user lives in Bengaluru, India." Use an empty array if nothing is worth storing. No prose, no markdown fences.`;

function parseMemories(raw: string): { content: string; kind: string }[] {
  const cleaned = raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { memories?: unknown })?.memories;
  if (!Array.isArray(list)) return [];
  const out: { content: string; kind: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const content = String((item as { content?: unknown }).content ?? "").trim();
    if (!content) continue;
    let kind = String((item as { kind?: unknown }).kind ?? "fact")
      .toLowerCase()
      .trim();
    if (kind !== "preference" && kind !== "context") kind = "fact";
    out.push({ content: content.slice(0, 280), kind });
    if (out.length >= MAX_EXTRACT) break;
  }
  return out;
}

/**
 * Builds the "What you know about the user" block that gets prepended to the
 * system prompt. Runs inside actions (no direct db access), so it queries via
 * runQuery/runAction. Never throws — memory is a nice-to-have, not a hard
 * dependency.
 *
 * The user's actual message is passed through so the facts can be ranked
 * against it. Without that, a preference learned six months ago ("I use Linux")
 * loses to whatever happened to be stored most recently, which is exactly the
 * case where being remembered matters.
 */
export async function memoryContextFor(
  ctx: QueryRunner,
  userId: string,
  query?: string,
): Promise<string> {
  if (!userId) return "";
  try {
    const rows = (await ctx.runAction(api.rag.recallFacts, {
      userId: userId as Id<"users">,
      ...(query ? { query } : {}),
      limit: MAX_CONTEXT_ITEMS,
    })) as { content: string }[] | null;
    const lines = (rows ?? [])
      .map((r) => (r?.content ?? "").trim())
      .filter((c) => c.length > 0);
    if (lines.length === 0) return "";
    return [
      "Long-term memory about this user (facts you learned in earlier sessions).",
      "Treat these as true. If one contradicts what the user says right now, trust the user.",
      "",
      ...lines.map((l) => `- ${l}`),
    ].join("\n");
  } catch {
    return "";
  }
}

/**
 * Called after a user/assistant exchange to mine it for durable memories and
 * persist them. Intentionally best-effort: a failure here never surfaces to the
 * user or breaks the chat turn.
 */
export const extract = action({
  args: {
    userMessage: v.string(),
    assistantMessage: v.string(),
  },
  handler: async (ctx, args): Promise<{ added: number }> => {
    const key = process.env.GROQ_API_KEY;
    if (!key) return { added: 0 };

    // The user is whoever is signed in — the client never supplies an id, so
    // one account can never write into another's memory.
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { added: 0 };

    const userMessage = (args.userMessage ?? "").trim();
    if (userMessage.length < 8) return { added: 0 };

    const exchange = [
      `User: ${userMessage.slice(0, 1200)}`,
      `Assistant: ${(args.assistantMessage ?? "").trim().slice(0, 600)}`,
    ].join("\n");

    let raw = "";
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            temperature: 0.1,
            max_tokens: 400,
            messages: [
              { role: "system", content: MEMORY_SYSTEM_PROMPT },
              { role: "user", content: exchange },
            ],
          }),
        },
      );
      if (!res.ok) return { added: 0 };
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      raw = json.choices?.[0]?.message?.content ?? "";
    } catch {
      return { added: 0 };
    }

    const items = parseMemories(raw);
    if (items.length === 0) return { added: 0 };

    let stored: { id: Id<"memories">; content: string; kind: string }[] = [];
    try {
      stored = (await ctx.runMutation(internal.memories.addMany, {
        userId,
        items,
      })) as { id: Id<"memories">; content: string; kind: string }[];
    } catch {
      return { added: 0 };
    }
    if (stored.length === 0) return { added: 0 };

    return { added: stored.length };
  },
});

/**
 * Remember something on purpose ("Remember this" in the panel).
 *
 * Writes to the Convex list the panel reads and that recall ranks against.
 */
export const remember = action({
  args: {
    content: v.string(),
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ added: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const content = args.content.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!content) throw new Error("Nothing to remember.");

    const storedId: Id<"memories"> | null = await ctx.runMutation(
      internal.memories.addOne,
      { userId, content, kind: args.kind ?? "fact" },
    );
    if (!storedId) return { added: 0 };

    return { added: 1 };
  },
});

/**
 * Forget one fact.
 *
 * The Convex row is the only store, so this is a mutation's worth of work
 * wrapped in an action purely to keep the panel's calling convention uniform.
 */
export const forget = action({
  args: { id: v.id("memories") },
  handler: async (ctx, args): Promise<{ removed: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const removed: boolean = await ctx.runMutation(internal.memories.removeRow, {
      id: args.id,
    });
    if (!removed) return { removed: 0 };

    return { removed: 1 };
  },
});

/** Forget everything. */
export const forgetAll = action({
  args: {},
  handler: async (ctx): Promise<{ removed: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const count: number = await ctx.runMutation(internal.memories.clearRows, {
      userId,
    });
    return { removed: count };
  },
});
