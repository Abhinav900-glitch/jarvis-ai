import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // Folders that group chats. Deleting one leaves its chats behind, set to
    // unfiled, because losing a conversation to a tidy-up is never what the
    // user meant.
    projects: defineTable({
      userId: v.id("users"),
      name: v.string(),
      color: v.optional(v.string()),
      icon: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_created", ["userId", "createdAt"]),

    // Reusable instruction sets. A session can pin one so every reply in that
    // conversation answers as that persona; the user's own instructions sit
    // above whichever persona is active.
    personas: defineTable({
      userId: v.id("users"),
      name: v.string(),
      /** Appended to the system prompt as extra standing instructions. */
      instructions: v.string(),
      /** Emoji shown in the picker. */
      icon: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"]),

    // One row per user: the free-form standing instructions ("how Jarvis
    // should work"), plus which persona is active.
    userSettings: defineTable({
      userId: v.id("users"),
      customInstructions: v.optional(v.string()),
      activePersonaId: v.optional(v.id("personas")),
      /**
       * Let the engine router choose a model per turn instead of walking a
       * fixed provider order. On by default; the pin in Settings overrides it.
       */
      smartEngine: v.optional(v.boolean()),
      /** `provider/model` the user pinned, which outranks the router. */
      pinnedEngineId: v.optional(v.string()),
      /**
       * After a reply, also answer with the best *different* engine on a new
       * branch. Off by default because it costs a second full generation.
       */
      autoBranch: v.optional(v.boolean()),
      updatedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // Recurring or one-off jobs Jarvis runs on its own: a morning digest, a
    // nightly backup check, a reminder to stretch. The cron sweeps for due
    // rows, so the schedule is stored rather than held in memory.
    scheduledTasks: defineTable({
      userId: v.id("users"),
      title: v.string(),
      /** The instruction the task runs. */
      prompt: v.string(),
      /** Where completed runs are posted. */
      sessionId: v.optional(v.id("chatSessions")),
      kind: v.union(
        v.literal("once"),
        v.literal("hourly"),
        v.literal("daily"),
        v.literal("weekly"),
      ),
      /** For "once": the wall-clock time to fire, ms epoch. */
      runAt: v.optional(v.number()),
      /** For "daily"/"weekly": minutes past local midnight. */
      minuteOfDay: v.optional(v.number()),
      /** For "weekly": 0 = Sunday. */
      dayOfWeek: v.optional(v.number()),
      /** IANA zone, so "9am" means 9am where the user is. */
      timezone: v.optional(v.string()),
      enabled: v.optional(v.boolean()),
      lastRunAt: v.optional(v.number()),
      lastResult: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_enabled", ["enabled"]),

    // Jarvis AI chat sessions
    chatSessions: defineTable({
      userId: v.id("users"),
      title: v.string(),
      projectId: v.optional(v.id("projects")),
      personaId: v.optional(v.id("personas")),
      pinned: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_updated", ["userId", "updatedAt"])
      .index("by_project", ["projectId"]),

    // An alternative continuation of a conversation. Editing an old message or
    // regenerating a reply does not destroy the old path: it forks a branch
    // that shares the history up to the fork point and then diverges, so the
    // original is always one click away.
    chatBranches: defineTable({
      sessionId: v.id("chatSessions"),
      userId: v.id("users"),
      /** The message the fork happened at. */
      forkedAtMessageId: v.optional(v.id("chatMessages")),
      /** "main" for the original line of conversation. */
      name: v.string(),
      createdAt: v.number(),
    })
      .index("by_session", ["sessionId"])
      .index("by_user", ["userId"]),

    // Jarvis AI chat messages
    chatMessages: defineTable({
      sessionId: v.id("chatSessions"),
      userId: v.id("users"),
      /** The branch this message belongs to; absent means the main line. */
      branchId: v.optional(v.id("chatBranches")),
      /**
       * Position within a set of siblings, so regenerating offers "1 of 3"
       * rather than silently discarding the reply the user already read.
       */
      variantIndex: v.optional(v.number()),
      role: v.union(
        v.literal("user"),
        v.literal("assistant"),
        v.literal("system"),
      ),
      content: v.string(),
      model: v.optional(v.string()),
      usedFallback: v.optional(v.boolean()),
      usedSearch: v.optional(v.boolean()),
      /** Kept by the user as one of the things worth finding again. */
      pinned: v.optional(v.boolean()),
      /** `provider/model` from the engine registry, for the answer inspector. */
      engineId: v.optional(v.string()),
      /** Why the router picked that engine, in one short clause. */
      decisionReason: v.optional(v.string()),
      /** Wall-clock time to the first token, ms. */
      latencyMs: v.optional(v.number()),
      /** Token usage, when the provider reported it. */
      promptTokens: v.optional(v.number()),
      completionTokens: v.optional(v.number()),
      /**
       * The alternative answer on a decision branch, and the branch it lives
       * on. Both are set together, and only by the smart-engine second answer.
       */
      altMessageId: v.optional(v.id("chatMessages")),
      altBranchId: v.optional(v.id("chatBranches")),
      /** Marks the second answer as machine-generated, not the user's own. */
      isDecisionBranch: v.optional(v.boolean()),
      /**
       * Set by the user pressing Stop. Read by the streaming loop on every
       * flush, which is where the check costs nothing — the flush was already
       * a database write happening ~11 times a second.
       */
      cancelRequested: v.optional(v.boolean()),
      /** True when the reply stopped early because it was cancelled. */
      truncated: v.optional(v.boolean()),
      sources: v.optional(
        v.array(
          v.object({
            title: v.string(),
            url: v.string(),
            domain: v.optional(v.string()),
          }),
        ),
      ),
      imageUrl: v.optional(v.string()),
      imagePublicId: v.optional(v.string()),
      images: v.optional(
        v.array(
          v.object({
            url: v.string(),
            publicId: v.optional(v.string()),
          }),
        ),
      ),
      fileUrl: v.optional(v.string()),
      fileName: v.optional(v.string()),
      fileType: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      /**
       * Every attachment on the message, not just the first. `fileUrl` and
       * friends above stay for the single-file case that predates this.
       */
      attachments: v.optional(
        v.array(
          v.object({
            url: v.string(),
            name: v.string(),
            type: v.optional(v.string()),
            size: v.optional(v.number()),
            /** Extracted text, for documents the model should read. */
            text: v.optional(v.string()),
          }),
        ),
      ),
      createdAt: v.number(),
    })
      .index("by_session", ["sessionId"])
      .index("by_branch", ["branchId"])
      // Backs the pinned list, which spans every session at once.
      .index("by_user", ["userId"]),

    // RAG: embeddings of past chat messages for semantic retrieval.
    // Embeddings use HuggingFace feature-extraction (384-dim all-MiniLM-L6-v2).
    messageEmbeddings: defineTable({
      userId: v.id("users"),
      sessionId: v.id("chatSessions"),
      messageId: v.id("chatMessages"),
      content: v.string(),
      role: v.string(),
      vector: v.array(v.float64()),
      createdAt: v.number(),
    })
      .vectorIndex("by_embedding", {
        vectorField: "vector",
        dimensions: 384,
        filterFields: ["userId"],
      })
      .index("by_user_time", ["userId", "createdAt"]),

    // Saved prompt library (per user)
    prompts: defineTable({
      userId: v.id("users"),
      title: v.string(),
      content: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Long-term memory: durable facts about the user, extracted from chat and
    // injected into future prompts. Fully user-controlled — every row can be
    // deleted from the Memory panel.
    memories: defineTable({
      userId: v.id("users"),
      content: v.string(),
      kind: v.union(
        v.literal("fact"),
        v.literal("preference"),
        v.literal("note"),
      ),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_time", ["userId", "createdAt"]),

    // ---- Agentic runs (AeroTransformGen Dev) ----------------------------
    // A run is one task the user handed over. Jarvis plans it, works the
    // steps, and only stops when a step is genuinely gated on a human
    // decision — the whole point of the feature is that the user is not
    // consulted for anything the agent can reasonably settle itself.
    agentRuns: defineTable({
      userId: v.id("users"),
      goal: v.string(),
      title: v.string(),
      status: v.union(
        v.literal("planning"),
        v.literal("running"),
        v.literal("awaiting_user"),
        v.literal("done"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
      /**
       * How much the agent may do without asking. Codex's sandbox modes.
       * `readonly` refuses every write, `ask` proposes each one for approval,
       * `auto` applies them. Default is `ask` because an agent that can rewrite
       * files and never shows you the rewrite is not a tool, it is a hazard.
       */
      mode: v.union(
        v.literal("readonly"),
        v.literal("ask"),
        v.literal("auto"),
      ),
      /** Antigravity's cascade: a cheap model drafts, a strong one refines. */
      cascade: v.optional(v.boolean()),
      /** How many steps the plan called for, once planned. */
      planned: v.number(),
      /** How many have actually been worked. */
      done: v.number(),
      /** Free-tier calls this run has spent. */
      calls: v.number(),
      answer: v.optional(v.string()),
      error: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_time", ["userId", "createdAt"]),

    agentSteps: defineTable({
      runId: v.id("agentRuns"),
      userId: v.id("users"),
      position: v.number(),
      title: v.string(),
      detail: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("running"),
        v.literal("done"),
        v.literal("failed"),
        v.literal("needs_decision"),
      ),
      /** `provider/model` of the engine that actually answered this step. */
      engineId: v.optional(v.string()),
      output: v.optional(v.string()),
      /** The agent's own one-clause reason for how it approached the step. */
      rationale: v.optional(v.string()),
      /**
       * Why this step stopped for the user. Always set when the status is
       * `needs_decision`, and it names the rule that fired rather than just
       * repeating the question — otherwise a pause is indistinguishable
       * from the agent being unsure.
       */
      gateReason: v.optional(v.string()),
      question: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      /** What the user picked, or free text. */
      answer: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_run", ["runId"]),

    // ---- The agent's workspace -----------------------------------------
    // What makes AeroTransformGen Dev a coding agent rather than a chat panel: it owns
    // files it can read, edit and run, so a step produces a real change rather
    // than a snippet in a transcript.
    //
    // A path is a normalised, forward-slashed, relative path and is unique per
    // user. There is deliberately no folder table — a tree is derived by
    // splitting paths — because a real filesystem model here would be one more
    // thing that can disagree with the files it claims to contain.
    workspaceFiles: defineTable({
      userId: v.id("users"),
      path: v.string(),
      content: v.string(),
      size: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_path", ["userId", "path"]),

    // A snapshot of one file taken immediately before the agent overwrites it.
    // `previous` is optional because its absence is meaningful: it records that
    // the file did not exist, so a rewind deletes rather than restoring.
    workspaceCheckpoints: defineTable({
      userId: v.id("users"),
      path: v.string(),
      previous: v.optional(v.string()),
      runId: v.optional(v.id("agentRuns")),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_time", ["userId", "createdAt"]),

    // An edit the agent wants to make but has not made. In "ask" mode every
    // write lands here first, as a before/after pair, and the run blocks until
    // the user approves or rejects it. This is the whole safety story for an
    // agent that can rewrite files: nothing lands that was not shown.
    agentProposals: defineTable({
      runId: v.id("agentRuns"),
      userId: v.id("users"),
      path: v.string(),
      before: v.optional(v.string()),
      // Optional because a delete proposal has no "after" — and losing that
      // distinction would mean an approved delete could restore the file.
      after: v.optional(v.string()),
      summary: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("applied"),
        v.literal("rejected"),
      ),
      createdAt: v.number(),
    })
      .index("by_run", ["runId"])
      .index("by_user", ["userId"]),

    // Generated sound effects (dog bark, thunder, ...). The prompt hash is the
    // cache key, so a given sound is only ever generated once and is then
    // served straight out of file storage.
    soundEffects: defineTable({
      promptHash: v.string(),
      prompt: v.string(),
      storageId: v.id("_storage"),
      createdAt: v.number(),
    }).index("by_hash", ["promptHash"]),

    // Cloudinary OAuth 2.0 connection (one row per user)
    cloudinaryAuth: defineTable({
      userId: v.id("users"),
      accessToken: v.optional(v.string()),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()), // ms epoch
      scope: v.optional(v.string()),
      redirectUri: v.optional(v.string()), // redirect used at flow start (must match at exchange)
      pendingState: v.optional(v.string()), // CSRF state while connecting
      connectedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // tableName: defineTable({
    //   ...
    //   // table fields
    // }).index("by_field", ["field"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
