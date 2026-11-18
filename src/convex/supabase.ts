// ---------------------------------------------------------------------------
// Supabase — the SQL copy of the Image Studio's history.
//
// Convex stays the source of truth for the app (auth, chats, agents). What it
// is not good at is the thing Image Studio history needs: surviving a cleared
// browser, being readable from a second device, and being queryable with real
// SQL. So the studio's local history is mirrored into a Postgres table through
// PostgREST, and pulled back on a device that has none.
//
// Every call here goes through the REST API with `fetch` rather than a client
// library, for the same reason the provider legs do: one endpoint, no bundle,
// and the headers visible in the code that needs them.
//
// The secret key must never reach the browser. That is why the write path is an
// action — the client sends its entries, the deployment holds the key. The env
// lists below accept the legacy `service_role` spelling, and a `VITE_`-prefixed
// secret only so the integration works at all: the status query flags that
// case, because Vite inlines those names into the bundle every visitor
// downloads.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";

/** Where the project lives. `VITE_` / `NEXT_PUBLIC_` spellings are accepted. */
const SUPABASE_URL_ENVS = [
  "SUPABASE_URL",
  "SUPABASE_PROJECT_URL",
  "VITE_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;

/**
 * The server key: `sb_secret_…` on a current project, the `service_role` JWT on
 * an older one. It bypasses Row Level Security, so it is only ever read inside
 * these actions and never returned from one.
 */
const SUPABASE_SECRET_ENVS = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "VITE_SUPABASE_SECRET_KEY",
  "VITE_SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** The table the SQL migration creates. One name, used by every request. */
const TABLE = "studio_renders";

/** How many pictures one backup may send. A press is not a bulk export. */
const BACKUP_LIMIT = 50;

/** How many rows a pull may bring back into this browser. */
const PULL_LIMIT = 60;

interface SupabaseConfig {
  /** Base URL, without a trailing slash. */
  url: string;
  secret: string;
  /** Which env name the secret came from, so the status can warn about it. */
  keySource: string;
}

/** First configured value among `names`, with the name it came from. */
function firstEnv(
  names: readonly string[],
): { name: string; value: string } | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return { name, value: value.trim() };
    }
  }
  return null;
}

/**
 * The project URL and key, or the one sentence explaining which half is
 * missing. Never includes the key itself — the message is shown in the UI.
 */
function supabaseConfig(): { config: SupabaseConfig } | { message: string } {
  const url = firstEnv(SUPABASE_URL_ENVS);
  const secret = firstEnv(SUPABASE_SECRET_ENVS);
  if (!url || !secret) {
    return {
      message:
        "Supabase isn't configured — add SUPABASE_URL and SUPABASE_SECRET_KEY in the Keys tab.",
    };
  }
  try {
    new URL(url.value);
  } catch {
    return { message: "SUPABASE_URL isn't a valid address." };
  }
  return {
    config: {
      url: url.value.replace(/\/+$/, ""),
      secret: secret.value,
      keySource: secret.name,
    },
  };
}

/**
 * PostgREST's error objects, flattened to one sentence. The hint is included
 * when there is one: "permission denied … grant select on table" is useless
 * without it.
 */
function describeError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const hint = typeof record.hint === "string" ? record.hint.trim() : "";
  if (!message) return null;
  return hint ? `${message} (${hint})` : message;
}

/** PostgREST's way of saying the table has not been created yet. */
function isMissingTable(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /does not exist|schema cache/i.test(message)
  );
}

interface PostgrestReply {
  ok: boolean;
  rows: unknown[];
  /** Human-readable failure, or null when the request succeeded. */
  message: string | null;
  /** True when the only problem is that the migration has not been run. */
  tableMissing: boolean;
}

/** One REST call, with every failure turned into a sentence rather than a throw. */
async function postgrest(
  config: SupabaseConfig,
  path: string,
  init: { method: string; body?: unknown; prefer?: string },
): Promise<PostgrestReply> {
  const headers: Record<string, string> = {
    apikey: config.secret,
    Authorization: `Bearer ${config.secret}`,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.prefer) headers.Prefer = init.prefer;

  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (err) {
    return {
      ok: false,
      rows: [],
      tableMissing: false,
      message: `Couldn't reach Supabase — ${
        err instanceof Error ? err.message : "network error"
      }.`,
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A body that is not JSON is treated as empty; the status still applies.
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      rows: [],
      tableMissing: isMissingTable(parsed),
      message:
        describeError(parsed) ?? `Supabase answered ${response.status}.`,
    };
  }
  return {
    ok: true,
    rows: Array.isArray(parsed) ? parsed : parsed ? [parsed] : [],
    tableMissing: false,
    message: null,
  };
}

/**
 * What the studio needs to know before it offers the controls at all.
 *
 * An action rather than a query only because the panel asks for it on open:
 * the answer never changes while the page is live, so a subscription would be
 * a watcher nobody needs.
 */
export const status = action({
  args: {},
  handler: async () => {
    const url = firstEnv(SUPABASE_URL_ENVS);
    const secret = firstEnv(SUPABASE_SECRET_ENVS);
    let urlHost: string | null = null;
    if (url) {
      try {
        urlHost = new URL(url.value).host;
      } catch {
        urlHost = null;
      }
    }
    const warnings: string[] = [];
    // The dangerous case, stated where it will be seen: a secret key under a
    // client-facing prefix is published to anyone who opens dev tools.
    if (secret && secret.name.startsWith("VITE_")) {
      warnings.push(
        `The secret key is stored as ${secret.name}. Vite inlines VITE_* into the browser bundle, so rename it to SUPABASE_SECRET_KEY in the Keys tab.`,
      );
    }
    return {
      configured: Boolean(url && urlHost && secret),
      urlHost,
      /** Env name only — never the key. */
      keySource: secret?.name ?? null,
      table: TABLE,
      warnings,
    };
  },
});

/**
 * Whether the key works and the migration has been run.
 *
 * Deliberately holds no user data: it is one row-selecting ping, so the panel
 * can say "connected" instead of only failing when a picture is saved.
 */
export const check = action({
  args: {},
  handler: async () => {
    const config = supabaseConfig();
    if ("message" in config) return { ok: false, message: config.message };
    const reply = await postgrest(config.config, `${TABLE}?select=id&limit=1`, {
      method: "GET",
    });
    if (!reply.ok) {
      return {
        ok: false,
        message: reply.tableMissing
          ? "Connected, but the studio_renders table is missing — run supabase/migrations/0001_studio_renders.sql in Supabase's SQL editor."
          : reply.message,
      };
    }
    return { ok: true, message: null };
  },
});

/** One picture, as the studio knows it. */
const renderInput = v.object({
  url: v.string(),
  prompt: v.string(),
  kind: v.string(),
  provider: v.optional(v.string()),
  aspect: v.optional(v.string()),
  score: v.optional(v.number()),
  refined: v.optional(v.boolean()),
  pinned: v.optional(v.boolean()),
  reference: v.optional(v.string()),
  pageTitle: v.optional(v.string()),
  createdAt: v.number(),
});

/** The fields the studio sends, mirrored from the validator above. */
interface RenderInput {
  url: string;
  prompt: string;
  kind: string;
  provider?: string;
  aspect?: string;
  score?: number;
  refined?: boolean;
  pinned?: boolean;
  reference?: string;
  pageTitle?: string;
  createdAt: number;
}

/**
 * One studio picture as a Postgres row.
 *
 * `user_id` is the Convex user id as text: this table is not read by Supabase
 * Auth, so there is no auth.users row to point at. The unique constraint is
 * `(user_id, image_url)`, which is what makes an upsert update rather than
 * duplicate.
 */
function rowFromEntry(userId: string, entry: RenderInput): Record<string, unknown> {
  return {
    user_id: userId,
    image_url: entry.url,
    prompt: entry.prompt,
    kind: entry.kind === "web" ? "web" : "ai",
    provider: entry.provider ?? null,
    aspect: entry.aspect ?? null,
    score: entry.score ?? null,
    refined: entry.refined ?? false,
    pinned: entry.pinned ?? false,
    reference: entry.reference ?? null,
    page_title: entry.pageTitle ?? null,
    created_at: new Date(entry.createdAt).toISOString(),
  };
}

/** Rows are keyed by owner and picture, so backing up twice updates in place. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Copy this browser's studio history into Postgres.
 *
 * Upsert, not insert: pressing Back up twice must not duplicate anything, and
 * a pin or a score changed here should land on the row that already exists.
 * `data:` URLs are skipped rather than sent — a base64 picture can be megabytes
 * and PostgREST would reject half of them.
 */
export const backup = action({
  args: { entries: v.array(renderInput) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { saved: 0, skipped: 0, message: "Sign in to copy history to Supabase." };
    }
    const config = supabaseConfig();
    if ("message" in config) {
      return { saved: 0, skipped: 0, message: config.message };
    }

    const rows = args.entries
      .slice(0, BACKUP_LIMIT)
      .filter((entry) => isHttpUrl(entry.url))
      .map((entry) => rowFromEntry(String(userId), entry));

    const skipped = args.entries.length - rows.length;
    if (rows.length === 0) {
      return {
        saved: 0,
        skipped,
        message:
          skipped > 0
            ? "Nothing to send — inline pictures (data: URLs) can't be stored in Postgres."
            : "Nothing to send yet.",
      };
    }

    const reply = await postgrest(
      config.config,
      `${TABLE}?on_conflict=user_id,image_url`,
      {
        method: "POST",
        body: rows,
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
    if (!reply.ok) {
      return {
        saved: 0,
        skipped,
        message: reply.tableMissing
          ? "The studio_renders table doesn't exist yet — run supabase/migrations/0001_studio_renders.sql in Supabase's SQL editor."
          : reply.message,
      };
    }
    return {
      saved: rows.length,
      skipped,
      message:
        skipped > 0
          ? `Saved ${rows.length} — ${skipped} inline picture${skipped === 1 ? "" : "s"} skipped.`
          : null,
    };
  },
});

/** One stored picture, in the studio's own terms. */
interface RenderRow {
  url: string;
  prompt: string;
  kind: string;
  provider?: string;
  aspect?: string;
  score?: number;
  refined: boolean;
  pinned: boolean;
  reference?: string;
  pageTitle?: string;
  shareSlug?: string;
  createdAt: number;
}

/**
 * A PostgREST row as a picture, or null for a row with no usable address.
 *
 * Shared by every read path, so `pull` and the gallery can never disagree
 * about what a stored picture is.
 */
function entryFromRow(row: unknown): RenderRow | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const url = typeof record.image_url === "string" ? record.image_url : "";
  if (!url) return null;
  const at = Date.parse(String(record.created_at ?? ""));
  return {
    url,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    kind: record.kind === "web" ? "web" : "ai",
    provider: typeof record.provider === "string" ? record.provider : undefined,
    aspect: typeof record.aspect === "string" ? record.aspect : undefined,
    score: typeof record.score === "number" ? record.score : undefined,
    refined: record.refined === true,
    pinned: record.pinned === true,
    reference:
      typeof record.reference === "string" ? record.reference : undefined,
    pageTitle:
      typeof record.page_title === "string" ? record.page_title : undefined,
    shareSlug:
      typeof record.share_slug === "string" ? record.share_slug : undefined,
    /** Falls back to now for a row whose date the database mangled. */
    createdAt: Number.isNaN(at) ? Date.now() : at,
  };
}

/** The columns every read asks for. One list, so a new field lands everywhere. */
const READ_COLUMNS =
  "image_url,prompt,kind,provider,aspect,score,refined,pinned,reference,page_title,created_at,share_slug";

/**
 * Read this account's pictures back, newest first.
 *
 * This is what makes the copy useful on a second device: the studio's local
 * history is empty there, and these rows are the only record of it.
 */
export const pull = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { entries: [], message: "Sign in to read history from Supabase." };
    }
    const config = supabaseConfig();
    if ("message" in config) {
      return { entries: [], message: config.message };
    }

    const query = [
      `select=${READ_COLUMNS}`,
      `user_id=eq.${encodeURIComponent(String(userId))}`,
      `order=created_at.desc`,
      `limit=${PULL_LIMIT}`,
    ].join("&");

    const reply = await postgrest(config.config, `${TABLE}?${query}`, {
      method: "GET",
    });
    if (!reply.ok) {
      return {
        entries: [],
        message: reply.tableMissing
          ? "The studio_renders table doesn't exist yet — run supabase/migrations/0001_studio_renders.sql in Supabase's SQL editor."
          : reply.message,
      };
    }

    const entries = reply.rows.flatMap((row) => {
      const entry = entryFromRow(row);
      return entry ? [entry] : [];
    });

    return { entries, message: null };
  },
});

/** How many pictures the gallery page may ask for in one read. */
const LIST_LIMIT = 200;

/**
 * Every picture this account has stored, newest first — the gallery page's
 * read.
 *
 * `pull` deliberately stops at the size of Recent; this one is for looking at
 * the whole archive, so the ceiling is much higher and the page asks for what
 * it can show. Still bounded: an unbounded select is a page that hangs when an
 * account has been busy for a year.
 */
export const list = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { entries: [], message: "Sign in to open the gallery." };
    }
    const config = supabaseConfig();
    if ("message" in config) {
      return { entries: [], message: config.message };
    }

    const limit = Math.min(
      Math.max(Math.round(args.limit ?? LIST_LIMIT), 1),
      LIST_LIMIT,
    );
    const query = [
      `select=${READ_COLUMNS}`,
      `user_id=eq.${encodeURIComponent(String(userId))}`,
      `order=created_at.desc`,
      `limit=${limit}`,
    ].join("&");

    const reply = await postgrest(config.config, `${TABLE}?${query}`, {
      method: "GET",
    });
    if (!reply.ok) {
      return {
        entries: [],
        message: reply.tableMissing
          ? "The studio_renders table doesn't exist yet — run supabase/migrations/0001_studio_renders.sql in Supabase's SQL editor."
          : reply.message,
      };
    }

    return {
      entries: reply.rows.flatMap((row) => {
        const entry = entryFromRow(row);
        return entry ? [entry] : [];
      }),
      message: null,
    };
  },
});

/**
 * A public link's slug: 18 hex characters, so it cannot be walked. The column
 * is unique, and Postgres would reject a collision rather than serve the wrong
 * picture to the wrong link — the chance is around one in 2^72.
 */
function newShareSlug(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 18);
}

/**
 * Publish one picture behind a link that works without signing in.
 *
 * The row is upserted rather than required to exist first, so sharing is one
 * press even for a picture that was never backed up. Sharing again replaces the
 * slug — which is also how a link that leaked gets retired.
 */
export const share = action({
  args: { entry: renderInput },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { slug: null, message: "Sign in to share a picture." };
    if (!isHttpUrl(args.entry.url)) {
      return {
        slug: null,
        message:
          "Only http(s) pictures can be shared — an inline picture has no address a link could open.",
      };
    }
    const config = supabaseConfig();
    if ("message" in config) return { slug: null, message: config.message };

    const slug = newShareSlug();
    const reply = await postgrest(
      config.config,
      `${TABLE}?on_conflict=user_id,image_url`,
      {
        method: "POST",
        body: [
          {
            ...rowFromEntry(String(userId), args.entry),
            share_slug: slug,
            shared_at: new Date().toISOString(),
          },
        ],
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );
    if (!reply.ok) {
      return {
        slug: null,
        message: reply.tableMissing
          ? "Sharing needs the studio_renders table — run supabase/migrations/0001_studio_renders.sql, then 0002_share_links.sql."
          : reply.message,
      };
    }
    return { slug, message: null };
  },
});

/** Take a picture off the public internet again. */
export const unshare = action({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, message: "Sign in to change a shared link." };
    const config = supabaseConfig();
    if ("message" in config) return { ok: false, message: config.message };

    // Scoped by user_id as well as slug: a slug from another account must not
    // be revocable by knowing it.
    const query = `user_id=eq.${encodeURIComponent(
      String(userId),
    )}&share_slug=eq.${encodeURIComponent(args.slug)}`;
    const reply = await postgrest(config.config, `${TABLE}?${query}`, {
      method: "PATCH",
      body: { share_slug: null, shared_at: null },
      prefer: "return=minimal",
    });
    return { ok: reply.ok, message: reply.message };
  },
});

/**
 * The picture behind a share link — the only read this deployment exposes
 * without a signed-in user.
 *
 * It selects by slug and returns the public fields only, so the secret key is
 * used to answer one question rather than to browse the table. Nothing about
 * the owner goes back: no user id, no email, no other rows.
 */
export const shared = action({
  args: { slug: v.string() },
  handler: async (_ctx, args) => {
    const slug = args.slug.trim();
    if (!slug) return { render: null, message: null };
    const config = supabaseConfig();
    if ("message" in config) return { render: null, message: config.message };

    const query = [
      `select=image_url,prompt,provider,page_title,score,created_at`,
      `share_slug=eq.${encodeURIComponent(slug)}`,
      `limit=1`,
    ].join("&");
    const reply = await postgrest(config.config, `${TABLE}?${query}`, {
      method: "GET",
    });
    if (!reply.ok) {
      return {
        render: null,
        message: reply.tableMissing
          ? "Shared links aren't set up on this deployment yet."
          : reply.message,
      };
    }

    const row = reply.rows[0];
    if (!row || typeof row !== "object") return { render: null, message: null };
    const record = row as Record<string, unknown>;
    const url = typeof record.image_url === "string" ? record.image_url : "";
    if (!url) return { render: null, message: null };
    const at = Date.parse(String(record.created_at ?? ""));
    return {
      render: {
        url,
        prompt: typeof record.prompt === "string" ? record.prompt : "",
        provider: typeof record.provider === "string" ? record.provider : undefined,
        pageTitle:
          typeof record.page_title === "string" ? record.page_title : undefined,
        score: typeof record.score === "number" ? record.score : undefined,
        createdAt: Number.isNaN(at) ? null : at,
      },
      message: null,
    };
  },
});
