// ---------------------------------------------------------------------------
// GenHack backend.
//
// `start` plans the project and writes the first files immediately; `step`
// writes the next batch. Both are actions because they call the generator (and
// optionally a model), but the plan itself is pure and offline: no key, no
// network, no provider needed to produce a complete 120-file project.
//
// Every file is checked before it is stored (`checkFile`). A model file that
// fails the check is discarded and the template version is kept, so the
// project is never worse for having called a model.
// ---------------------------------------------------------------------------

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
import type { Doc } from "./_generated/dataModel";
import { DEFAULT_FILES, buildBlueprint, clampTarget, isStackId } from "../lib/genhack/blueprint";
import { checkFile } from "../lib/genhack/check";
import { fileRewritePrompt, stripCodeFences } from "../lib/genhack/prompts";
import type { StackId } from "../lib/genhack/types";

/** Files written by `start`, and by each `step` unless asked otherwise. */
const FIRST_BATCH = 14;
const MAX_STEP = 16;
/** Files per step the model may upgrade; the rest are template-fast. */
const AI_PER_STEP = 3;
const MAX_FILES = 300;

const fileRow = v.object({
  path: v.string(),
  language: v.string(),
  role: v.string(),
  content: v.string(),
  source: v.union(v.literal("template"), v.literal("ai")),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("genhackProjects")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});

export const get = query({
  args: { projectId: v.id("genhackProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) return null;

    const files = await ctx.db
      .query("genhackFiles")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .order("asc")
      .take(MAX_FILES);

    return { project, files };
  },
});

export const load = internalQuery({
  args: { projectId: v.id("genhackProjects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    title: v.string(),
    brief: v.string(),
    stack: v.union(v.literal("react"), v.literal("node"), v.literal("python")),
    targetFiles: v.number(),
    paths: v.array(v.string()),
    totalLines: v.number(),
    aiAssist: v.boolean(),
    files: v.array(fileRow),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const writtenLines = args.files.reduce((sum, entry) => sum + entry.content.split("\n").length, 0);
    const projectId = await ctx.db.insert("genhackProjects", {
      userId: args.userId,
      name: args.name,
      title: args.title,
      brief: args.brief,
      stack: args.stack,
      targetFiles: args.targetFiles,
      paths: args.paths,
      total: args.paths.length,
      written: args.files.length,
      totalLines: args.totalLines,
      writtenLines,
      status: args.files.length >= args.paths.length ? "done" : "writing",
      aiAssist: args.aiAssist,
      aiFiles: args.files.filter((entry) => entry.source === "ai").length,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, entry] of args.files.entries()) {
      await ctx.db.insert("genhackFiles", {
        projectId,
        userId: args.userId,
        path: entry.path,
        language: entry.language,
        role: entry.role,
        content: entry.content,
        source: entry.source,
        order: index,
        updatedAt: now,
      });
    }
    return projectId;
  },
});

export const append = internalMutation({
  args: {
    projectId: v.id("genhackProjects"),
    files: v.array(fileRow),
    engine: v.optional(v.string()),
    aiFiles: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found.");

    const now = Date.now();
    let writtenLines = project.writtenLines;
    for (const [index, entry] of args.files.entries()) {
      await ctx.db.insert("genhackFiles", {
        projectId: args.projectId,
        userId: project.userId,
        path: entry.path,
        language: entry.language,
        role: entry.role,
        content: entry.content,
        source: entry.source,
        order: project.written + index,
        updatedAt: now,
      });
      writtenLines += entry.content.split("\n").length;
    }

    const written = project.written + args.files.length;
    await ctx.db.patch(args.projectId, {
      written,
      writtenLines,
      status: written >= project.total ? "done" : "writing",
      aiFiles: project.aiFiles + args.aiFiles,
      engine: args.engine ?? project.engine,
      updatedAt: now,
    });
  },
});

export const start = action({
  args: {
    brief: v.string(),
    stack: v.optional(v.string()),
    targetFiles: v.optional(v.number()),
    aiAssist: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Doc<"genhackProjects"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to build a project.");

    const brief = args.brief.replace(/\s+/g, " ").trim().slice(0, 600);
    if (!brief) throw new Error("Describe what to build first.");

    const stack: StackId = args.stack && isStackId(args.stack) ? args.stack : "react";
    const targetFiles = clampTarget(args.targetFiles ?? DEFAULT_FILES);
    const blueprint = buildBlueprint({ brief, stack, targetFiles });

    const first = blueprint.files.slice(0, FIRST_BATCH).map((entry) => ({
      path: entry.path,
      language: entry.language,
      role: entry.role,
      content: entry.content,
      source: "template" as const,
    }));

    const projectId = await ctx.runMutation(internal.genhack.create, {
      userId,
      name: blueprint.name,
      title: blueprint.title,
      brief,
      stack,
      targetFiles,
      paths: blueprint.files.map((entry) => entry.path),
      totalLines: blueprint.lines,
      aiAssist: Boolean(args.aiAssist),
      files: first,
    });

    return await ctx.runQuery(internal.genhack.load, { projectId });
  },
});

export const step = action({
  args: {
    projectId: v.id("genhackProjects"),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    project: Doc<"genhackProjects"> | null;
    written: number;
    total: number;
    last: string[];
    engine?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to write files.");

    const project = await ctx.runQuery(internal.genhack.load, { projectId: args.projectId });
    if (!project || project.userId !== userId) throw new Error("Project not found.");

    if (project.written >= project.total) {
      return { project, written: project.written, total: project.total, last: [] };
    }

    const limit = Math.max(1, Math.min(Math.round(args.limit ?? 8), MAX_STEP));
    const blueprint = buildBlueprint({
      brief: project.brief,
      stack: project.stack,
      targetFiles: project.targetFiles,
    });
    const planned = new Map(blueprint.files.map((entry) => [entry.path, entry]));
    const nextPaths = project.paths.slice(project.written, project.written + limit);

    const rows: {
      path: string;
      language: string;
      role: string;
      content: string;
      source: "template" | "ai";
    }[] = [];
    let engine: string | undefined;
    let aiFiles = 0;

    for (const path of nextPaths) {
      const entry = planned.get(path);
      if (!entry) continue;

      let content = entry.content;
      let source: "template" | "ai" = "template";

      if (project.aiAssist && aiFiles < AI_PER_STEP) {
        const rewrite = await ctx
          .runAction(internal.ai.codeTurn, {
            prompt: fileRewritePrompt({
              project: project.title,
              stack: project.stack,
              path,
              language: entry.language,
              role: entry.role,
              siblings: project.paths,
              current: entry.content,
            }),
          })
          .catch(() => null);

        const text = rewrite ? stripCodeFences(rewrite.text) : "";
        if (text.trim().length > 40) {
          const issues = checkFile(path, text);
          if (!issues.some((issue) => issue.severity === "error")) {
            content = text.endsWith("\n") ? text : text + "\n";
            source = "ai";
            aiFiles += 1;
            engine = rewrite?.engineId;
          }
        }
      }

      rows.push({ path, language: entry.language, role: entry.role, content, source });
    }

    await ctx.runMutation(internal.genhack.append, {
      projectId: args.projectId,
      files: rows,
      engine,
      aiFiles,
    });

    const updated = await ctx.runQuery(internal.genhack.load, { projectId: args.projectId });
    return {
      project: updated,
      written: updated?.written ?? project.written,
      total: project.total,
      last: rows.map((row) => row.path),
      engine,
    };
  },
});

const MAX_CONTENT = 200_000;

/**
 * Save a file the person edited by hand.
 *
 * The project's line total moves with the edit so the header stays truthful;
 * the checker runs in the UI against the new content, so a file saved with a
 * stray brace shows up broken immediately rather than on download.
 */
export const saveFile = mutation({
  args: { fileId: v.id("genhackFiles"), content: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to edit a file.");
    if (args.content.trim().length === 0) throw new Error("A file cannot be empty.");
    if (args.content.length > MAX_CONTENT) {
      throw new Error("That is larger than a source file should be.");
    }

    const file = await ctx.db.get(args.fileId);
    if (!file || file.userId !== userId) throw new Error("File not found.");
    const project = await ctx.db.get(file.projectId);
    if (!project) throw new Error("Project not found.");

    const before = file.content.split("\n").length;
    const after = args.content.split("\n").length;
    const now = Date.now();

    await ctx.db.patch(file._id, { content: args.content, edited: true, updatedAt: now });
    await ctx.db.patch(file.projectId, {
      writtenLines: Math.max(0, project.writtenLines + (after - before)),
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { projectId: v.id("genhackProjects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to delete a project.");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Project not found.");

    const files = await ctx.db
      .query("genhackFiles")
      .withIndex("by_project_order", (q) => q.eq("projectId", args.projectId))
      .take(MAX_FILES);
    for (const file of files) await ctx.db.delete(file._id);
    await ctx.db.delete(args.projectId);
  },
});
