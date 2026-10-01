import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Projects: named folders that group chats.
//
// A project is deliberately thin — a name and an optional colour. Everything
// else a folder wants (ordering, nesting, permissions) is complexity the user
// did not ask for, and the sidebar already groups by recency.
//
// Deleting a project never deletes its chats. They become unfiled and stay in
// the list, because "remove this folder" and "throw away these conversations"
// are different requests and only the first one was made.
// ---------------------------------------------------------------------------

/** Muted hues that read as a single system against the dark sidebar. */
export const PROJECT_COLORS = [
  "#38bdf8",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#4ade80",
  "#facc15",
  "#2dd4bf",
  "#f87171",
] as const;

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { projects: [], unfiledCount: 0 };

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();

    // Counts come from one grouped pass rather than a query per project, so
    // the sidebar stays a single round trip.
    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const counts = new Map<Id<"projects">, number>();
    let unfiledCount = 0;
    for (const session of sessions) {
      if (!session.projectId) {
        unfiledCount += 1;
        continue;
      }
      counts.set(session.projectId, (counts.get(session.projectId) ?? 0) + 1);
    }

    return {
      projects: projects.map((project) => ({
        ...project,
        chatCount: counts.get(project._id) ?? 0,
      })),
      unfiledCount,
    };
  },
});

export const createProject = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to create a project.");

    const name = args.name.trim().slice(0, 60);
    if (!name) throw new Error("Give the project a name.");

    return await ctx.db.insert("projects", {
      userId,
      name,
      color: args.color,
      icon: args.icon,
      createdAt: Date.now(),
    });
  },
});

export const updateProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Project not found.");

    const patch: { name?: string; color?: string; icon?: string } = {};
    if (args.name !== undefined) {
      const name = args.name.trim().slice(0, 60);
      if (!name) throw new Error("Give the project a name.");
      patch.name = name;
    }
    if (args.color !== undefined) patch.color = args.color;
    if (args.icon !== undefined) patch.icon = args.icon;
    await ctx.db.patch(args.projectId, patch);
  },
});

/** Moves chats into a project, or out of all of them with a null projectId. */
export const assignSessions = mutation({
  args: {
    projectId: v.union(v.id("projects"), v.null()),
    sessionIds: v.array(v.id("chatSessions")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.userId !== userId) throw new Error("Project not found.");
    }

    for (const sessionId of args.sessionIds.slice(0, 200)) {
      const session = await ctx.db.get(sessionId);
      // Ownership is re-checked per row: a caller must not be able to file
      // somebody else's chat into a folder just by guessing its id.
      if (!session || session.userId !== userId) continue;
      await ctx.db.patch(sessionId, { projectId: args.projectId ?? undefined });
    }
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.userId !== userId) throw new Error("Project not found.");

    // Unfile rather than cascade-delete. The chats survive.
    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const session of sessions) {
      if (session.projectId === args.projectId) {
        await ctx.db.patch(session._id, { projectId: undefined });
      }
    }

    await ctx.db.delete(args.projectId);
    return sessions.filter((s) => s.projectId === args.projectId).length;
  },
});
