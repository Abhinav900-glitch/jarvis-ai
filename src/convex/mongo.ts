// ---------------------------------------------------------------------------
// MongoDB Atlas — the long-term memory corpus.
//
// Why the Data API and not the MongoDB driver
// -------------------------------------------
// Convex actions run on a serverless runtime with no TCP sockets, so the
// official `mongodb` driver cannot open a connection no matter how it is
// configured. Atlas's Data API is the same cluster reached over HTTPS, which is
// exactly what this runtime can do. Same database, same indexes, same free
// cluster — just a different wire protocol.
//
// What lives here, and why
// ------------------------
// Two things, and nothing else:
//
//   `memory`  — one document per durable fact plus one per indexed exchange.
//               This is the recall corpus: it grows without bound over time and
//               is only ever read by similarity search.
//   `settings` — per-user memory preferences (which backend is authoritative,
//               how many facts to inject into the prompt).
//
// The small, user-editable list of facts that the Memory panel shows stays in
// Convex. Putting a list of thirty rows behind a network hop to read and delete
// one of them would make the panel slower for no benefit; Convex's transactional
// deletes are the right tool for that, and it stays the system of record for
// what the user can see and remove.
//
// Every function here returns null / empty when MongoDB is not configured, and
// callers fall back to the Convex store. Adding the keys is therefore a
// progressive upgrade, never a breaking change.
//
// Nothing here throws. A memory backend that is down must degrade the assistant
// to "no long-term recall", not fail the reply.
// ---------------------------------------------------------------------------

const DB_NAME = process.env.MONGODB_DATABASE?.trim() || "jarvis";

export interface MongoConfig {
  url: string;
  apiKey: string;
  database: string;
}

/** The configured Data API endpoint, or null when it is not set up. */
export function mongoConfig(): MongoConfig | null {
  const url = process.env.MONGODB_DATA_API_URL?.trim();
  const apiKey = process.env.MONGODB_API_KEY?.trim();
  if (!url || !apiKey) return null;
  return { url: url.replace(/\/+$/, ""), apiKey, database: DB_NAME };
}

export function mongoConfigured(): boolean {
  return mongoConfig() !== null;
}

export const MEMORY_COLLECTION = "memory";
export const MEMORY_SETTINGS_COLLECTION = "memory_settings";

type Json = Record<string, unknown>;

async function call<T>(
  path: string,
  init: { method: string; body?: Json },
): Promise<T | null> {
  const config = mongoConfig();
  if (!config) return null;

  try {
    const res = await fetch(`${config.url}/v1/${config.database}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "api-key": config.apiKey,
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[mongo] ${init.method} ${path} failed (${res.status}): ${detail.slice(0, 200)}`,
      );
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.error(`[mongo] ${init.method} ${path} error:`, err);
    return null;
  }
}

export interface FindOptions {
  sort?: Json;
  limit?: number;
  /** Field list to return. Omit for whole documents. */
  projection?: Record<string, 0 | 1>;
}

/** Find documents. Returns [] when unconfigured or on error. */
export async function mongoFind<T>(
  collection: string,
  filter: Json,
  options: FindOptions = {},
): Promise<T[]> {
  const body: Json = {
    filter,
    limit: Math.min(Math.max(options.limit ?? 50, 1), 1000),
  };
  if (options.sort) body.sort = options.sort;
  if (options.projection) body.projection = options.projection;

  const data = await call<{ documents?: T[] }>(`/${collection}/find`, {
    method: "POST",
    body,
  });
  return data?.documents ?? [];
}

/** Insert many. Returns the number the server reports accepting. */
export async function mongoInsertMany(
  collection: string,
  documents: Json[],
): Promise<number> {
  if (documents.length === 0) return 0;
  const data = await call<{ insertedIds?: string[] }>(`/${collection}/insertMany`, {
    method: "POST",
    body: { documents },
  });
  return data?.insertedIds?.length ?? 0;
}

/** Run an aggregation pipeline. */
export async function mongoAggregate<T>(
  collection: string,
  pipeline: Json[],
): Promise<T[]> {
  const data = await call<{ documents?: T[] }>(`/${collection}/aggregate`, {
    method: "POST",
    body: { pipeline },
  });
  return data?.documents ?? [];
}

/** Delete matching documents. Returns how many were removed. */
export async function mongoDeleteMany(
  collection: string,
  filter: Json,
): Promise<number> {
  const data = await call<{ deletedCount?: number }>(`/${collection}/deleteMany`, {
    method: "POST",
    body: { filter },
  });
  return data?.deletedCount ?? 0;
}

/** Upsert a single document by a stable key. */
export async function mongoUpdateOne(
  collection: string,
  filter: Json,
  update: Json,
  upsert = true,
): Promise<boolean> {
  const data = await call<{ matchedCount?: number; upsertedCount?: number }>(
    `/${collection}/updateOne`,
    {
      method: "POST",
      body: { filter, update, upsert },
    },
  );
  if (!data) return false;
  return (data.matchedCount ?? 0) > 0 || (data.upsertedCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// The memory corpus shape
// ---------------------------------------------------------------------------

export type MemoryKind = "fact" | "preference" | "note" | "exchange";

export interface MemoryDoc {
  /** `${userId}:${sourceId}` — stable, so re-indexing is idempotent. */
  _id: string;
  userId: string;
  kind: MemoryKind;
  content: string;
  /** Set for exchanges only. */
  sessionId?: string;
  messageId?: string;
  role?: string;
  /** Voyage embedding, when one could be produced. */
  embedding?: number[];
  createdAt: number;
}

/**
 * Text-match candidates, ranked by a crude keyword overlap first.
 *
 * Deliberately a MongoDB `$regex` rather than an Atlas Search index: the free
 * cluster does not reliably provide one, and a regex over a per-user corpus
 * that is measured in thousands of documents is fast enough. Voyage's reranker
 * does the real work afterwards, so this stage only has to be *recall-oriented*
 * — recall more than needed and let the reranker discard.
 */
export async function mongoCandidates(
  userId: string,
  query: string,
  limit: number,
): Promise<MemoryDoc[]> {
  // Keywords long enough to mean something. Single characters and stop-word-ish
  // fragments would match most of the corpus and make the candidate set useless.
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 4),
    ),
  ).slice(0, 8);

  const recent = await mongoFind<MemoryDoc>(
    MEMORY_COLLECTION,
    { userId },
    { sort: { createdAt: -1 }, limit: Math.max(limit, 120) },
  );
  if (terms.length === 0) return recent;

  const keyword = await mongoFind<MemoryDoc>(
    MEMORY_COLLECTION,
    {
      userId,
      content: { $regex: terms.join("|"), $options: "i" },
    },
    { sort: { createdAt: -1 }, limit: Math.max(limit, 120) },
  );

  // Union, newest first, de-duplicated by id.
  const seen = new Set<string>();
  const merged: MemoryDoc[] = [];
  for (const doc of [...keyword, ...recent]) {
    if (seen.has(doc._id)) continue;
    seen.add(doc._id);
    merged.push(doc);
  }
  return merged;
}