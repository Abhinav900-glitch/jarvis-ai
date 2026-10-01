import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { DEFAULT_BEHAVIOR_INSTRUCTIONS } from "../lib/identity";

// ---------------------------------------------------------------------------
// Personas and standing instructions.
//
// Two separate knobs, deliberately. A PERSONA is a reusable character —
// "concise technical reviewer" — that can be saved, renamed and pinned to a
// single chat. INSTRUCTIONS are one block of free text about how Jarvis should
// always work, applying to every conversation. Users reach for the second far
// more often, so it is the one exposed on the main surface.
//
// Neither can override the safety and honesty rules in the base prompt. They
// are appended after it as standing context, so a persona that asks for
// "never mention limitations" is asking for something the base prompt
// already forbids, and the base prompt wins.
// ---------------------------------------------------------------------------

/** A hard ceiling, so the prompt cannot be grown without bound. */
const MAX_INSTRUCTIONS = 4_000;
const MAX_PERSONA_INSTRUCTIONS = 2_000;

/** Personas offered before the user writes any of their own. */
export const STARTER_PERSONAS: {
  name: string;
  icon: string;
  instructions: string;
}[] = [
  {
    name: "Concise",
    icon: "✂️",
    instructions:
      "Answer in as few words as the question allows. No preamble, no restating the question, no summary of what you are about to say. Skip the pleasantries.",
  },
  {
    name: "Teacher",
    icon: "🎓",
    instructions:
      "Explain the why, not just the what. After giving an answer, add one short paragraph on the intuition behind it, aimed at someone learning this for the first time.",
  },
  {
    name: "Code reviewer",
    icon: "🧑‍💻",
    instructions:
      "Treat every request as a review task first. Lead with what is wrong and why it matters, then the fix. Point out correctness bugs before style. Be specific about file and line.",
  },
  {
    name: "Socratic",
    icon: "🏛️",
    instructions:
      "Do not answer directly at first. Ask the question that would help the user reach the answer themselves. Give the answer only if they ask again or are clearly stuck.",
  },
  {
    name: "Research analyst",
    icon: "🔬",
    instructions:
      "Separate what the evidence shows from what you infer. State confidence explicitly. Flag anything unverifiable. Prefer specific numbers over general claims.",
  },
  {
    name: "Creative partner",
    icon: "✨",
    instructions:
      "Offer two or three genuinely different directions rather than one safe option. Take a position. Do not open every reply by asking a clarifying question — make an assumption and say you made it.",
  },
];

export const listPersonas = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { personas: [], starters: STARTER_PERSONAS };
    const personas = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();
    return { personas, starters: STARTER_PERSONAS };
  },
});

export const savePersona = mutation({
  args: {
    name: v.string(),
    instructions: v.string(),
    icon: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to save a persona.");

    const name = args.name.trim().slice(0, 60);
    if (!name) throw new Error("Give the persona a name.");
    const instructions = args.instructions.trim().slice(0, MAX_PERSONA_INSTRUCTIONS);
    if (!instructions) throw new Error("The persona needs something to do.");

    if (args.personaId) {
      const existing = await ctx.db.get(args.personaId);
      if (!existing || existing.userId !== userId) {
        throw new Error("Persona not found.");
      }
      await ctx.db.patch(args.personaId, { name, instructions, icon: args.icon });
      return args.personaId;
    }

    return await ctx.db.insert("personas", {
      userId,
      name,
      instructions,
      icon: args.icon,
      createdAt: Date.now(),
    });
  },
});

export const deletePersona = mutation({
  args: { personaId: v.id("personas") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== userId) throw new Error("Persona not found.");

    // Clear it from the user, and from any session still pinning it, so a
    // deleted persona cannot leave a chat pointing at nothing.
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (settings?.activePersonaId === args.personaId) {
      await ctx.db.patch(settings._id, { activePersonaId: undefined });
    }

    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const session of sessions) {
      if (session.personaId === args.personaId) {
        await ctx.db.patch(session._id, { personaId: undefined });
      }
    }

    await ctx.db.delete(args.personaId);
  },
});

// ---------------------------------------------------------------------------
// Standing instructions
// ---------------------------------------------------------------------------

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!settings) return null;
    return {
      customInstructions: settings.customInstructions ?? "",
      activePersonaId: settings.activePersonaId ?? null,
      activePersona: settings.activePersonaId
        ? await ctx.db.get(settings.activePersonaId)
        : null,
    };
  },
});

export const saveSettings = mutation({
  args: {
    customInstructions: v.optional(v.string()),
    activePersonaId: v.union(v.id("personas"), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // An empty box clears the instructions rather than storing "" forever, so
    // the prompt is not padded with an empty section.
    const raw = args.customInstructions?.trim();
    const customInstructions = raw ? raw.slice(0, MAX_INSTRUCTIONS) : undefined;

    const activePersonaId = args.activePersonaId ?? undefined;
    if (activePersonaId) {
      const persona = await ctx.db.get(activePersonaId);
      if (!persona || persona.userId !== userId) {
        throw new Error("That persona no longer exists.");
      }
    }

    const patch: Partial<Doc<"userSettings">> = {
      customInstructions,
      activePersonaId,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("userSettings", { userId, ...patch });
  },
});

/**
 * The resolved instruction block for one user, as a string ready to append to
 * the system prompt. Called from the AI actions on every reply.
 *
 * Returns "" rather than throwing when anything is missing: a chat must not
 * fail because a persona was deleted a second ago.
 */
export async function instructionBlockFor(
  db: GenericDatabaseReader<DataModel>,
  userId: Id<"users">,
  /** Overrides the user's active persona, for a session that pinned one. */
  sessionPersonaId?: Id<"personas"> | null,
): Promise<string> {
  const settings = await db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first()
    .catch(() => null);

  const parts: string[] = [];
  const custom = settings?.customInstructions?.trim();

  if (custom) {
    parts.push(
      `STANDING INSTRUCTIONS FROM THE USER — these apply to every reply and outrank your usual habits:\n${custom}`,
    );
  } else {
    // Nothing of the user's own, so the house style applies.
    //
    // The model behind this app changes — GPT, Llama, Gemini, a local one —
    // and each has its own default habits. These rules are what makes the
    // behaviour the same whichever is configured. They are deliberately not
    // stored in the user's settings, so writing their own instructions replaces
    // them rather than stacking on top, and clearing the box brings them back.
    parts.push(
      `HOUSE STYLE — follow these on every reply:\n${DEFAULT_BEHAVIOR_INSTRUCTIONS}`,
    );
  }

  const personaId = sessionPersonaId ?? settings?.activePersonaId ?? null;
  if (personaId) {
    const persona = await db.get(personaId).catch(() => null);
    if (persona) {
      parts.push(
        `ACTIVE PERSONA: you are currently operating as "${persona.name}". Follow these instructions:\n${persona.instructions}`,
      );
    }
  }

  if (parts.length === 0) return "";
  return `\n\n---\n${parts.join("\n\n")}`;
}

/**
 * The user's own instructions and active persona, for live mode.
 *
 * Same sources as {@link instructionBlockFor}, minus the default house style.
 * That omission is the whole point of this query: live mode speaks its replies
 * through a speech synthesiser, and the house style asks for `**bold**`, bullet
 * lists and fenced code, all of which get read out loud as punctuation. Sending
 * it would make the assistant less like itself, not more.
 *
 * So the user's written instructions DO travel — those are the part where chat
 * and voice should agree — but silence falls back to identity plus manners
 * rather than to a text-formatting style that does not survive speech.
 *
 * Authenticated, like every other settings read: this is one user's private
 * standing instructions, and live mode is only usable while signed in.
 */
export const livePersona = query({
  args: {
    /** Overrides the user's active persona, for a session that pinned one. */
    personaId: v.optional(v.null()),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return "";

    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first()
      .catch(() => null);

    const parts: string[] = [];
    const custom = settings?.customInstructions?.trim();
    if (custom) {
      parts.push(
        `STANDING INSTRUCTIONS FROM THE USER — these apply to every reply and outrank your usual habits:\n${custom}`,
      );
    }

    const personaId = args.personaId ?? settings?.activePersonaId ?? null;
    if (personaId) {
      const persona = await ctx.db.get(personaId).catch(() => null);
      if (persona) {
        parts.push(
          `ACTIVE PERSONA: you are currently operating as "${persona.name}". Follow these instructions:\n${persona.instructions}`,
        );
      }
    }

    if (parts.length === 0) return "";
    return `\n\n---\n${parts.join("\n\n")}`;
  },
});

/**
 * Server-to-server entry point for {@link instructionBlockFor}. The AI actions
 * run on the node runtime and have no database reader of their own, so they
 * resolve the block through this internal query.
 */
export const instructionBlock = internalQuery({
  args: {
    userId: v.id("users"),
    personaId: v.optional(v.null()),
  },
  handler: async (ctx, args): Promise<string> => {
    return await instructionBlockFor(ctx.db, args.userId, args.personaId ?? null);
  },
});
