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
       * Who the user is: name, how to address them, profession, preferred
       * language. Sent as one ABOUT THE USER block so replies can be tailored;
       * every field empty (or the whole thing absent) means no block is sent.
       */
      profile: v.optional(
        v.object({
          name: v.optional(v.string()),
          addressAs: v.optional(v.string()),
          profession: v.optional(v.string()),
          language: v.optional(v.string()),
          /**
           * Short notes Jarvis sees on *every* turn — things you want every
           * reply to keep in mind that do not belong in standing instructions.
           * Shown (editable) in the Profile tab, read-only for the user.
           */
          concepts: v.optional(v.array(v.string())),
        }),
      ),
      /**
       * The structured half of personalization — length, tone, register, emoji.
       * Rendered into the prompt as a regulation with a compliance step, so the
       * rules are checked against each reply instead of merely describing a
       * mood. Absent means the user never configured it.
       */
      behavior: v.optional(
        v.object({
          length: v.union(
            v.literal("brief"),
            v.literal("balanced"),
            v.literal("detailed"),
          ),
          tone: v.union(
            v.literal("warm"),
            v.literal("neutral"),
            v.literal("direct"),
          ),
          register: v.union(
            v.literal("casual"),
            v.literal("plain"),
            v.literal("formal"),
          ),
          emoji: v.union(
            v.literal("never"),
            v.literal("light"),
            v.literal("frequent"),
          ),
        }),
      ),
      /**
       * Let the engine router choose a model per turn instead of walking a
       * fixed provider order. On by default; the pin in Settings overrides it.
       */
      smartEngine: v.optional(v.boolean()),
      /** `provider/model` the user pinned, which outranks the router. */
      pinnedEngineId: v.optional(v.string()),
      /**
       * Model plugins the user switched ON for chat (`PluginEntry.slug`).
       * Missing or empty = every installed plugin stays out of the router,
       * which is the shipped default for the free Meta models.
       */
      enabledModelPlugins: v.optional(v.array(v.string())),
      /**
       * After a reply, also answer with the best *different* engine on a new
       * branch. Off by default because it costs a second full generation.
       */
      autoBranch: v.optional(v.boolean()),
      /**
       * Self-hosted image endpoint (stable-diffusion.cpp / A1111 / ComfyUI API).
       * When set, it is tried before the hosted chain in `generateImage`. The
       * token is stored server-side only and never returned to the client.
       */
      imageServerUrl: v.optional(v.string()),
      imageServerModel: v.optional(v.string()),
      imageServerToken: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // The account's plugin archive: a zip holding a Claude-style plugin folder
    // and/or MCP server definitions, kept in file storage exactly as it was
    // handed over. One row per zip; `manifests` records what was detected
    // inside at upload time so the list can render without re-reading the
    // file. Nothing here executes — the flag is forward state for the day the
    // agent's MCP endpoint reads it.
    plugins: defineTable({
      userId: v.id("users"),
      /** Display name: the first manifest inside, else the file name. */
      name: v.string(),
      /** What the zip holds — a plugin folder, or MCP server definitions. */
      kind: v.union(v.literal("plugin"), v.literal("mcp")),
      version: v.optional(v.string()),
      description: v.optional(v.string()),
      fileName: v.string(),
      storageId: v.id("_storage"),
      sizeBytes: v.number(),
      fileCount: v.optional(v.number()),
      /** JSON array of { path, kind, name, version?, description? }. */
      manifests: v.optional(v.string()),
      enabled: v.boolean(),
      createdAt: v.number(),
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
      /**
       * Set when the user archives the chat. An archived chat keeps every
       * message but leaves the project groups and search, living under one
       * "Archived" list until it is restored or deleted. Absent = live.
       */
      archivedAt: v.optional(v.number()),
      /**
       * Set when the user deletes the chat. The row and its messages stay
       * intact under a Trash list until restored or purged, so a mis-click
       * costs one action instead of the conversation.
       * Absent = not in the trash; every read path filters on that.
       */
      deletedAt: v.optional(v.number()),
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
      /**
       * The user's verdict on this reply. Kept on the row it belongs to rather
       * than in a log, so the inspector can show it beside the engine that
       * earned it and the router can learn which engines get thumbed down.
       */
      feedback: v.optional(v.union(v.literal("up"), v.literal("down"))),
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
      /**
       * Real images found on the web for this turn, kept beside the generated
       * one so the transcript can show what actually exists out there — each
       * with the page it came from, credited and linked.
       */
      webImages: v.optional(
        v.array(
          v.object({
            url: v.string(),
            /** The page the image lives on — the credit link. */
            pageUrl: v.string(),
            source: v.string(),
            title: v.optional(v.string()),
          }),
        ),
      ),
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
       * `auto` applies them. `auto` is the default because it is the mode the
       * product is for — and it is safe to default to: every automatic write
       * is checkpointed first (so any single change can be rewound), the whole
       * mode can be switched mid-run, and {@link AUTO_WRITE_BUDGET} caps how
       * much one run may rewrite at all.
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
      /** File changes this run has applied itself (`auto` writes). */
      writes: v.optional(v.number()),
      /** Set once the verify step has been appended, so it is appended once. */
      verified: v.optional(v.boolean()),
      /**
       * Opt-in request/response recording for the trace inspector. Off by
       * default: a request body is the largest string this feature stores, and
       * most runs are watched, not debugged.
       */
      debug: v.optional(v.boolean()),
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
      /**
       * The console: model rounds and tool calls, appended as they happen
       * rather than collected at the end — a log that only appears when the
       * step finishes is a report, not a console. Capped by the store.
       */
      log: v.optional(
        v.array(
          v.object({
            at: v.number(),
            kind: v.union(v.literal("model"), v.literal("tool")),
            /** `provider/model` for a round, the tool's name for a call. */
            label: v.string(),
            detail: v.optional(v.string()),
            /** Wall-clock milliseconds for that round or call. */
            ms: v.optional(v.number()),
            promptTokens: v.optional(v.number()),
            completionTokens: v.optional(v.number()),
          }),
        ),
      ),
      /**
       * What was actually sent to the model and what it replied, per round.
       * Recorded only while the run's `debug` flag is on.
       */
      trace: v.optional(
        v.array(
          v.object({
            round: v.number(),
            engineId: v.optional(v.string()),
            model: v.optional(v.string()),
            ms: v.optional(v.number()),
            promptTokens: v.optional(v.number()),
            completionTokens: v.optional(v.number()),
            request: v.optional(v.string()),
            response: v.optional(v.string()),
            /** Tool names the model asked for in that round. */
            toolCalls: v.optional(v.string()),
          }),
        ),
      ),
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

    // ---- Files a program wrote ------------------------------------------
    // The engines return stdout and nothing else, so a deck built with
    // python-pptx has no way home. The program posts each file it made to this
    // deployment's HTTP endpoint instead, authorised by a token minted for that
    // one run: that is why a token appears here before any file does. A row
    // with no `storageId` is a grant waiting to be used; one with it is a
    // finished download.
    agentArtifacts: defineTable({
      userId: v.id("users"),
      /** Single-use-ish secret handed to the sandbox for this run. */
      token: v.string(),
      /** Empty on the grant row, the filename once a file arrives. */
      name: v.string(),
      mime: v.string(),
      size: v.number(),
      storageId: v.optional(v.id("_storage")),
      createdAt: v.number(),
    })
      .index("by_token", ["token"])
      .index("by_storage", ["storageId"])
      .index("by_user_time", ["userId", "createdAt"]),

    // ---- The user's own cloud --------------------------------------------
    // Anything a signed-in account wants to keep: an upload from this device,
    // or a file copied out of a run. The bytes live in Convex storage; this row
    // is the index and the owner, which is what makes the file theirs rather
    // than a random URL. `agentArtifacts` above is a transport for a single run
    // and is cleared; rows here are kept until the user deletes them.
    cloudFiles: defineTable({
      userId: v.id("users"),
      name: v.string(),
      mime: v.string(),
      size: v.number(),
      storageId: v.id("_storage"),
      /** Where it came from, so the panel can label it honestly. */
      source: v.optional(
        v.union(v.literal("upload"), v.literal("run"), v.literal("image")),
      ),
      /** Absent means unfiled — at the top level, not in a missing folder. */
      folderId: v.optional(v.id("cloudFolders")),
      createdAt: v.number(),
    }).index("by_user_time", ["userId", "createdAt"]),

    // Folders are flat on purpose: one level is enough to organise a drive and
    // keeps every listing a single indexed read. Deleting a folder unfiles its
    // contents rather than destroying them.
    cloudFolders: defineTable({
      userId: v.id("users"),
      name: v.string(),
      createdAt: v.number(),
    }).index("by_user_time", ["userId", "createdAt"]),

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

    // Researched visual references for fictional characters, keyed by a
    // normalised name ("Ben 10" → "ben10"). Cached because describing Goku
    // costs a web search and a model call, and the description is the same for
    // every account; rows are refreshed after 30 days so a character's newest
    // form still turns up.
    characterLooks: defineTable({
      key: v.string(),
      subject: v.string(),
      brief: v.string(),
      sources: v.array(v.object({ title: v.string(), url: v.string() })),
      model: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_key", ["key"]),

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

    // Canva OAuth 2.0 (authorization code + PKCE) connection (one row per user)
    canvaAuth: defineTable({
      userId: v.id("users"),
      accessToken: v.optional(v.string()),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()), // ms epoch
      scope: v.optional(v.string()),
      redirectUri: v.optional(v.string()),
      pendingState: v.optional(v.string()), // CSRF state while connecting
      // PKCE verifier. Canva requires S256, and the verifier cannot be
      // re-derived from the challenge, so it has to survive the redirect
      // round-trip. Cleared as soon as the code is exchanged.
      pendingCodeVerifier: v.optional(v.string()),
      /**
       * Every connect window currently in flight, newest last.
       *
       * One row holds several because one click does not mean one window:
       * clicking Connect in a second tab, or going back from Canva's consent
       * page and starting again, used to overwrite the single pending state —
       * so the window the user actually approved came back with a state
       * nothing recognised and the connection failed. Keeping the last few
       * (capped and aged out) lets any of them finish.
       *
       * `pendingState` / `pendingCodeVerifier` above are the legacy single-flow
       * form, still read as a fallback for a flow started before this existed.
       */
      pendingFlows: v.optional(
        v.array(
          v.object({
            state: v.string(),
            codeVerifier: v.string(),
            redirectUri: v.optional(v.string()),
            createdAt: v.number(),
          }),
        ),
      ),
      connectedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // Per-user material for chat encryption. Only two things live here, and
    // neither can open a message: a random salt (public by design) and a
    // verifier — a ciphertext the passphrase must be able to produce, so a
    // later attempt can be proved correct without ever storing the passphrase.
    e2eKeys: defineTable({
      userId: v.id("users"),
      salt: v.string(),
      verifier: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // ------------------------------------------------------------------------
    // Per-user MCP server connections.
    //
    // A user can hold many MCP servers (Canva is one special case below the
    // fold; these are for every other MCP — aggregators, self-hosted, remote).
    // The token is stored so the assistant can call the server on the user's
    // behalf. Open MCP endpoints don't need a token: an empty token means
    // "no auth header" for that server.
    // ------------------------------------------------------------------------
    mcpServers: defineTable({
      userId: v.id("users"),
      name: v.string(),
      url: v.string(),
      prefix: v.optional(v.string()),
      // Auth kind: "none", "bearer" (Bearer token in authValue), or
      // "header" (custom header name in authHeaderName, value in authValue).
      authType: v.optional(
        v.union(
          v.literal("none"),
          v.literal("bearer"),
          v.literal("header"),
        ),
      ),
      authValue: v.optional(v.string()),
      authHeaderName: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      lastTestedAt: v.optional(v.number()),
      toolCount: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }).index("by_user", ["userId"]),

    // ------------------------------------------------------------------------
    // A machine the user connected as Jarvis's own computer.
    //
    // Colab has no API, so the notebook itself is the agent: a pasted cell polls
    // `/machine/next` with this token, runs whatever Python it is handed on its
    // own interpreter, and posts the answer to `/machine/result`. One row per
    // user, because there is one notebook; connecting again rotates the token
    // and retires the old cell.
    // ------------------------------------------------------------------------
    machines: defineTable({
      userId: v.id("users"),
      name: v.string(),
      token: v.string(),
      /** The worker's Python version, e.g. "3.11.9". */
      version: v.optional(v.string()),
      /** What it is, so the panel can say "linux · 12 cores · Tesla T4". */
      platform: v.optional(v.string()),
      connectedAt: v.number(),
      /** Last poll, which is the only liveness signal a polling worker has. */
      lastSeenAt: v.number(),
      jobsRun: v.number(),
      lastError: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_token", ["token"]),

    // Work waiting for that machine. A row is the whole request and the whole
    // reply: queued, then running, then done or error. The runner waits on it
    // so an agent's `run_code` still returns an ordinary result.
    machineJobs: defineTable({
      userId: v.id("users"),
      language: v.string(),
      source: v.string(),
      stdin: v.string(),
      packages: v.array(v.string()),
      /** Lets the worker upload files it wrote, through `/artifact`. */
      artifactToken: v.optional(v.string()),
      state: v.string(),
      output: v.string(),
      error: v.string(),
      failed: v.boolean(),
      timedOut: v.boolean(),
      exitCode: v.number(),
      timeoutMs: v.number(),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
    })
      .index("by_user_state", ["userId", "state"])
      .index("by_state", ["state", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
