import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_SLIDES,
  MIN_SLIDES,
  extractJson,
  fallbackPlan,
  fallbackSlide,
  fitSlideKind,
  hasContent,
  normalizePlan,
  normalizeSlides,
  type DeckPlan,
  type SlideSpec,
} from "../lib/pptx/spec";
import {
  alignPlan,
  deckTitleFor,
  fallbackNotes,
  outlinePrompt,
  slidesPrompt,
  type DeckBrief,
} from "../lib/pptx/prompts";
import { suggestTheme, themeById } from "../lib/pptx/theme";

// ---------------------------------------------------------------------------
// Deck generation, in stages.
//
// A 40-slide deck is ~14 model calls, which is longer than one action should
// hold open. So `start` writes the outline and `step` writes the next batch,
// with the client looping until the deck is complete. The stored `slides` array
// is the resume point: closing the tab stops the loop, not the deck.
//
// Every AI call has a deterministic stand-in. A deck that comes back with a
// model-written outline and template-written slides is still a deck; a thrown
// exception in the middle of the pipeline would be nothing.
// ---------------------------------------------------------------------------

/** Slides per model call. Small enough to stay inside a token limit. */
const BATCH = 3;

const briefOf = (
  deck: { topic: string; tone?: string | null; audience?: string | null },
  slideCount: number,
): DeckBrief => ({
  topic: deck.topic,
  slideCount,
  tone: deck.tone ?? undefined,
  audience: deck.audience ?? undefined,
});

function clampCount(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : 12;
  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, n));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const get = query({
  args: { deckId: v.id("decks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const deck = await ctx.db.get(args.deckId);
    return deck && deck.userId === userId ? deck : null;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const decks = await ctx.db
      .query("decks")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(12);
    return decks.map((deck) => ({
      _id: deck._id,
      title: deck.title,
      topic: deck.topic,
      theme: deck.theme,
      status: deck.status,
      total: deck.total,
      written: deck.written,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
    }));
  },
});

export const remove = mutation({
  args: { deckId: v.id("decks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to delete a deck.");
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== userId) throw new Error("Deck not found.");
    await ctx.db.delete(args.deckId);
  },
});

/**
 * Change the look without regenerating the content.
 *
 * This is the advantage of storing a spec rather than a file: a deck is
 * re-themed by a row update, and the panel rebuilds the .pptx on download.
 */
export const retheme = mutation({
  args: { deckId: v.id("decks"), theme: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to re-theme a deck.");
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== userId) throw new Error("Deck not found.");
    await ctx.db.patch(args.deckId, {
      theme: themeById(args.theme).id,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Internal bookkeeping
// ---------------------------------------------------------------------------

export const load = internalQuery({
  args: { deckId: v.id("decks"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const deck = await ctx.db.get(args.deckId);
    return deck && deck.userId === args.userId ? deck : null;
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    topic: v.string(),
    theme: v.string(),
    tone: v.optional(v.string()),
    audience: v.optional(v.string()),
    plan: v.any(),
    total: v.number(),
    aiFailures: v.number(),
    engine: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"decks">> => {
    const now = Date.now();
    return await ctx.db.insert("decks", {
      userId: args.userId,
      title: args.title,
      topic: args.topic,
      theme: args.theme,
      tone: args.tone,
      audience: args.audience,
      plan: args.plan,
      slides: [],
      status: "writing",
      total: args.total,
      written: 0,
      aiFailures: args.aiFailures,
      engine: args.engine,
      error: args.error,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Append one batch.
 *
 * `expected` is the length the caller believed the deck had. A second loop
 * (two tabs, or an impatient click) would otherwise append the same batch
 * twice; with it, the stale call is a no-op and the caller re-reads.
 */
export const append = internalMutation({
  args: {
    deckId: v.id("decks"),
    userId: v.id("users"),
    slides: v.any(),
    expected: v.number(),
    engine: v.optional(v.string()),
    aiFailures: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== args.userId) throw new Error("Deck not found.");
    const existing = (deck.slides ?? []) as SlideSpec[];
    if (existing.length !== args.expected) return deck;
    const next = [...existing, ...(args.slides as SlideSpec[])].slice(0, MAX_SLIDES);
    const finished = next.length >= deck.total || next.length >= MAX_SLIDES;
    await ctx.db.patch(args.deckId, {
      slides: next,
      written: next.length,
      status: finished ? "done" : "writing",
      engine: args.engine ?? deck.engine,
      aiFailures: args.aiFailures,
      error: args.error,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.deckId);
  },
});

/** Mark a deck finished even though the plan ran short. */
export const finish = internalMutation({
  args: { deckId: v.id("decks"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== args.userId) throw new Error("Deck not found.");
    await ctx.db.patch(args.deckId, { status: "done", updatedAt: Date.now() });
    return await ctx.db.get(args.deckId);
  },
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const start = action({
  args: {
    topic: v.string(),
    slideCount: v.optional(v.number()),
    theme: v.optional(v.string()),
    tone: v.optional(v.string()),
    audience: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"decks"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to build a deck.");

    const topic = args.topic.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!topic) throw new Error("Give the deck a topic first.");
    const slideCount = clampCount(args.slideCount);
    const theme = themeById(args.theme ?? suggestTheme(topic).id).id;
    const brief: DeckBrief = {
      topic,
      slideCount,
      tone: args.tone?.trim().slice(0, 120) || undefined,
      audience: args.audience?.trim().slice(0, 120) || undefined,
    };

    let plan: DeckPlan;
    let engine: string | undefined;
    let aiFailures = 0;
    let error: string | undefined;

    try {
      const result = await ctx.runAction(internal.ai.deckTurn, {
        prompt: outlinePrompt(brief),
        temperature: 0.5,
      });
      const parsed = normalizePlan(extractJson(result.text), deckTitleFor(topic), slideCount);
      const aligned = alignPlan(parsed, brief);
      if (aligned.slides.length >= 5) {
        plan = aligned;
        engine = result.engineId;
      } else {
        // A plan that came back as four slides is a failed outline, not a
        // short deck: answering it with the template keeps the shape intact.
        plan = fallbackPlan(topic, slideCount);
        aiFailures = 1;
        error = "The model's outline was unusable; this deck's structure came from a template.";
      }
    } catch (err) {
      plan = fallbackPlan(topic, slideCount);
      aiFailures = 1;
      error = err instanceof Error ? err.message.slice(0, 300) : "Outline generation failed.";
    }

    const deckId = await ctx.runMutation(internal.decks.create, {
      userId,
      title: plan.title,
      topic,
      theme,
      tone: brief.tone,
      audience: brief.audience,
      plan,
      total: plan.slides.length,
      aiFailures,
      engine,
      error,
    });

    return await ctx.runQuery(internal.decks.load, { deckId, userId });
  },
});

export const step = action({
  args: { deckId: v.id("decks") },
  handler: async (ctx, args): Promise<Doc<"decks"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to build a deck.");

    const deck = await ctx.runQuery(internal.decks.load, {
      deckId: args.deckId,
      userId,
    });
    if (!deck) throw new Error("Deck not found.");
    if (deck.status === "done" || deck.status === "failed") return deck;

    const plan = (deck.plan ?? { slides: [] }) as DeckPlan;
    const written = (deck.slides ?? []) as SlideSpec[];
    const total = plan.slides.length;
    const brief = briefOf(deck, total);

    if (written.length >= total) {
      // Nothing left to write: an already-complete deck that never got its
      // status flipped is finished here rather than looping forever.
      return await ctx.runMutation(internal.decks.finish, {
        deckId: args.deckId,
        userId,
      });
    }

    const batch = plan.slides.slice(written.length, written.length + BATCH);
    let slideSpecs: SlideSpec[];
    let engine = deck.engine;
    let aiFailures = deck.aiFailures ?? 0;
    let error = deck.error;

    try {
      const result = await ctx.runAction(internal.ai.deckTurn, {
        prompt: slidesPrompt(
          brief,
          plan,
          batch.map((slide, i) => ({ index: written.length + i, ...slide })),
        ),
        temperature: 0.7,
      });
      const authored = normalizeSlides(extractJson(result.text));

      slideSpecs = batch.map((planned, i) => {
        const candidate = authored[i];
        if (!candidate) {
          aiFailures += 1;
          return ensureNotes(fallbackSlide(planned, deck.topic, written.length + i), deck.topic);
        }
        // The plan decided the shape; the writer fills it. A writer that
        // changes the kind is corrected, and the content it did produce is
        // kept where it still fits.
        const fitted = fitSlideKind({ ...candidate, kind: planned.kind });
        if (!hasContent(fitted)) {
          aiFailures += 1;
          return ensureNotes(fallbackSlide(planned, deck.topic, written.length + i), deck.topic);
        }
        return ensureNotes(
          {
            ...fitted,
            title: fitted.title || planned.title,
            // An eyebrow is a label, not a sentence: a long "purpose" from the
            // plan would render as a paragraph above the title.
            kicker: fitted.kicker && fitted.kicker.length <= 48 ? fitted.kicker : undefined,
          },
          deck.topic,
        );
      });
      engine = result.engineId ?? engine;
      error = undefined;
    } catch (err) {
      aiFailures += 1;
      slideSpecs = batch.map((planned, i) =>
        ensureNotes(fallbackSlide(planned, deck.topic, written.length + i), deck.topic),
      );
      error = err instanceof Error ? err.message.slice(0, 300) : "Slide writing failed.";
    }

    return await ctx.runMutation(internal.decks.append, {
      deckId: args.deckId,
      userId,
      slides: slideSpecs,
      expected: written.length,
      engine,
      aiFailures,
      error,
    });
  },
});

function ensureNotes(slide: SlideSpec, topic: string): SlideSpec {
  return slide.notes?.trim()
    ? slide
    : { ...slide, notes: fallbackNotes(slide, topic) };
}
