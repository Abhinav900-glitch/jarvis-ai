"use node";

// ---------------------------------------------------------------------------
// Live lookups that are not a web index.
//
// `search_web` answers "what does the web say". Three questions it is bad at
// have their own sources, and each is key-gated:
//
//   places   — Google Maps through SerpAPI: a name, an address, a rating, the
//              opening state, a phone number, a pin you can click. Organic
//              search results are the wrong shape for "coffee near me".
//   recipes  — Spoonacular: cooking time, servings, ingredients with amounts,
//              and the page the recipe came from, so a suggestion can actually
//              be cooked instead of described.
//   aiMode   — Google's own answer engine through SerpAPI, with the reference
//              list it cites. Useful when a question wants a synthesis and the
//              sources behind it, not ten blue links.
//
// Every action returns `ok: false` with a sentence rather than throwing: a
// missing key or an exhausted quota is information the agent can pass to the
// user, not a reason to end a run.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

/** A string field, or "" — SerpAPI omits keys on some rows. */
const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/** A finite number, or null. Ratings arrive as numbers, never as strings. */
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * SerpApi keys in priority order.
 *
 * Two spellings of the backup key are accepted because the deployment has held
 * both at different times (`SERPAPI_API_KEY_2` in one place, `SERPAPI_API_KEY2`
 * in the Keys tab); reading one and not the other is how a working key looks
 * unconfigured.
 */
function serpApiKeys(): string[] {
  return [
    process.env.SERPAPI_API_KEY,
    process.env.SERPAPI_API_KEY2,
    process.env.SERPAPI_API_KEY_2,
  ]
    .map((key) => key?.trim())
    .filter((key): key is string => Boolean(key));
}

/**
 * One SerpAPI call, trying each key in turn.
 *
 * A non-200 or an `error` field moves on to the next key — the usual reason the
 * first one fails is the daily quota, and the backup exists for exactly that.
 * The exception is a genuine empty result: that is the query's answer, and
 * spending the second key to hear it again is waste.
 */
async function serpApi(
  engine: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const keys = serpApiKeys();
  if (keys.length === 0) {
    throw new Error("SERPAPI_API_KEY is not configured");
  }

  const failures: string[] = [];
  for (const key of keys) {
    const query = new URLSearchParams({ engine, api_key: key, hl: "en", ...params });
    const res = await fetch(`https://serpapi.com/search.json?${query}`, {
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      failures.push(`${engine} answered ${res.status}`);
      continue;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const error = text(data.error);
    if (error) {
      if (/hasn't returned any results|has not returned any results/i.test(error)) {
        throw new Error(error);
      }
      failures.push(error);
      continue;
    }
    return data;
  }
  throw new Error(failures.join(" · ").slice(0, 200) || `${engine} failed`);
}

/** One place, in the terms a person reading an answer needs. */
interface Place {
  name: string;
  type: string;
  address: string;
  rating: number | null;
  reviews: number | null;
  price: string;
  openState: string;
  hours: { day: string; hours: string }[];
  phone: string;
  website: string;
  mapsUrl: string;
  lat: number | null;
  lng: number | null;
}

/**
 * Google Maps local search.
 *
 * `near` is folded into the query rather than turned into coordinates: the
 * Google Maps engine resolves "in Barcelona" itself, and geocoding the place
 * name first would cost a second search to save nothing.
 */
export const places = internalAction({
  args: {
    query: v.string(),
    near: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const query = args.query.trim().slice(0, 200);
    if (!query) {
      return { ok: false, places: [], message: "The place query was empty." };
    }
    const near = args.near?.trim().slice(0, 100);
    const limit = Math.min(Math.max(Math.round(args.limit ?? 6), 1), 10);
    const q = near ? `${query} in ${near}` : query;

    let data: Record<string, unknown>;
    try {
      data = await serpApi("google_maps", { q });
    } catch (err) {
      return {
        ok: false,
        places: [],
        message: err instanceof Error ? err.message : "Google Maps failed.",
      };
    }

    const rows = Array.isArray(data.local_results) ? data.local_results : [];
    const places: Place[] = [];
    for (const raw of rows.slice(0, limit)) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const name = text(row.title);
      if (!name) continue;

      const coordinates =
        row.gps_coordinates && typeof row.gps_coordinates === "object"
          ? (row.gps_coordinates as Record<string, unknown>)
          : {};
      const hours =
        row.operating_hours && typeof row.operating_hours === "object"
          ? Object.entries(row.operating_hours as Record<string, unknown>)
              .map(([day, value]) => ({ day, hours: text(value) }))
              .filter((entry) => entry.hours)
          : [];
      const address = text(row.address);

      places.push({
        name,
        type: text(row.type) || (Array.isArray(row.types) ? text(row.types[0]) : ""),
        address,
        rating: num(row.rating),
        reviews: num(row.reviews),
        price: text(row.price),
        openState: text(row.open_state) || text(row.hours),
        hours,
        phone: text(row.phone),
        website: text(row.website),
        // A link a person can open, rather than SerpAPI's own JSON endpoint:
        // the API's `place_id_search` needs a key, and this does not.
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [name, address].filter(Boolean).join(" "),
        )}`,
        lat: num(coordinates.latitude),
        lng: num(coordinates.longitude),
      });
    }

    return {
      ok: places.length > 0,
      places,
      message:
        places.length > 0
          ? null
          : `Google Maps returned no places for "${q}".`,
    };
  },
});

/** One cited source behind an AI Mode answer. */
interface Citation {
  title: string;
  url: string;
  source: string;
  snippet: string;
}

/** What one AI Mode lookup produced. Shared by the tool and deep research. */
export interface AiModeLookup {
  ok: boolean;
  answer: string;
  references: Citation[];
  message: string | null;
}

/**
 * Google AI Mode: a synthesized answer with the pages it leaned on.
 *
 * The text blocks are joined in order, headings kept as headings, because the
 * structure is most of what makes the answer readable. `reconstructed_markdown`
 * is the fallback for a response that arrives without blocks.
 *
 * Exported as a plain function as well as an action: deep research calls it
 * directly when its own providers came back thin, and a `ctx.runAction` from
 * inside a prompt-building helper is not available there.
 */
export async function fetchAiMode(rawQuery: string): Promise<AiModeLookup> {
  const query = rawQuery.trim().slice(0, 300);
  if (!query) {
    return { ok: false, answer: "", references: [], message: "The question was empty." };
  }

  let data: Record<string, unknown>;
  try {
    data = await serpApi("google_ai_mode", { q: query });
  } catch (err) {
    return {
      ok: false,
      answer: "",
      references: [],
      message: err instanceof Error ? err.message : "Google AI Mode failed.",
    };
  }

  const blocks = Array.isArray(data.text_blocks) ? data.text_blocks : [];
  const parts: string[] = [];
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;

    // Lists carry their text in `list[].snippet`, not in the block's own
    // snippet — dropping them is how an answer keeps its headings and loses
    // every point underneath.
    if (block.type === "list" && Array.isArray(block.list)) {
      const items = block.list.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const line = text((item as Record<string, unknown>).snippet);
        return line ? [`- ${line}`] : [];
      });
      if (items.length > 0) parts.push(items.join("\n"));
      continue;
    }

    const snippet = text(block.snippet);
    if (!snippet) continue;
    parts.push(block.type === "heading" ? `## ${snippet}` : snippet);
  }
  const answer =
    parts.join("\n\n").slice(0, 3000) ||
    text(data.reconstructed_markdown).slice(0, 3000);

  const references: Citation[] = [];
  for (const raw of Array.isArray(data.references) ? data.references : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const url = text(row.link);
    if (!url) continue;
    references.push({
      title: text(row.title) || url,
      url,
      source: text(row.source),
      snippet: text(row.snippet).slice(0, 300),
    });
    if (references.length >= 8) break;
  }

  return {
    ok: Boolean(answer),
    answer,
    references,
    message: answer ? null : `Google AI Mode had no answer for "${query}".`,
  };
}

/** The agent tool: the same lookup, as an action. */
export const aiMode = internalAction({
  args: { query: v.string() },
  handler: async (_ctx, args) => await fetchAiMode(args.query),
});

/** One recipe, with enough to decide whether to cook it. */
interface Recipe {
  title: string;
  url: string;
  source: string;
  minutes: number | null;
  servings: number | null;
  healthScore: number | null;
  diets: string[];
  dishTypes: string[];
  ingredients: string[];
  summary: string;
}

/** Spoonacular summaries are HTML; the answer needs a sentence. */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    // Tags leave a space before the punctuation that followed them
    // ("33g of protein , 14g"), which reads as a typo in an answer.
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Recipe search through Spoonacular.
 *
 * `sort=popularity` only when no time limit is set: the point of asking for a
 * 30-minute dinner is the 30 minutes, and popularity would bury the quick
 * options under better-known slow ones.
 */
export const recipes = internalAction({
  args: {
    query: v.string(),
    diet: v.optional(v.string()),
    maxReadyTime: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const query = args.query.trim().slice(0, 200);
    if (!query) {
      return { ok: false, recipes: [], message: "The recipe query was empty." };
    }
    const key = process.env.SPOONACULAR_API_KEY?.trim();
    if (!key) {
      return {
        ok: false,
        recipes: [],
        message: "SPOONACULAR_API_KEY is not configured.",
      };
    }

    const limit = Math.min(Math.max(Math.round(args.limit ?? 5), 1), 10);
    const maxReadyTime = args.maxReadyTime
      ? Math.min(Math.max(Math.round(args.maxReadyTime), 5), 360)
      : undefined;
    const params = new URLSearchParams({
      apiKey: key,
      query,
      number: String(limit),
      addRecipeInformation: "true",
      fillIngredients: "true",
    });
    const diet = args.diet?.trim().toLowerCase().slice(0, 30);
    if (diet) params.set("diet", diet);
    if (maxReadyTime) {
      params.set("maxReadyTime", String(maxReadyTime));
    } else {
      params.set("sort", "popularity");
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.spoonacular.com/recipes/complexSearch?${params}`,
        { signal: AbortSignal.timeout(20_000) },
      );
    } catch (err) {
      return {
        ok: false,
        recipes: [],
        message: `Couldn't reach Spoonacular — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const body = await response.text();
    if (!response.ok) {
      // 402 is the one worth naming: the free tier is a daily point budget and
      // a 402 otherwise reads like a bug in this code.
      return {
        ok: false,
        recipes: [],
        message:
          response.status === 401
            ? "Spoonacular rejected the key — check SPOONACULAR_API_KEY."
            : response.status === 402
              ? "Spoonacular's daily points are used up for today."
              : `Spoonacular answered ${response.status}${body ? ` — ${body.slice(0, 120)}` : "."}`,
      };
    }

    let data: { results?: unknown };
    try {
      data = JSON.parse(body) as { results?: unknown };
    } catch {
      return {
        ok: false,
        recipes: [],
        message: "Spoonacular answered with something that is not JSON.",
      };
    }

    const rows = Array.isArray(data.results) ? data.results : [];
    const recipes: Recipe[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const title = text(row.title);
      if (!title) continue;
      const ingredients = Array.isArray(row.extendedIngredients)
        ? row.extendedIngredients
            .flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const entry = item as Record<string, unknown>;
              const line = text(entry.original) || text(entry.name);
              return line ? [line] : [];
            })
            .slice(0, 12)
        : [];
      recipes.push({
        title,
        url: text(row.sourceUrl) || text(row.spoonacularSourceUrl),
        source: text(row.sourceName),
        minutes: num(row.readyInMinutes),
        servings: num(row.servings),
        healthScore: num(row.healthScore),
        diets: Array.isArray(row.diets)
          ? row.diets.filter((entry): entry is string => typeof entry === "string")
          : [],
        dishTypes: Array.isArray(row.dishTypes)
          ? row.dishTypes.filter((entry): entry is string => typeof entry === "string")
          : [],
        ingredients,
        summary: stripHtml(text(row.summary)).slice(0, 260),
      });
    }

    return {
      ok: recipes.length > 0,
      recipes,
      message:
        recipes.length > 0
          ? null
          : `Spoonacular found no recipes for "${query}"${
              maxReadyTime ? ` under ${maxReadyTime} minutes` : ""
            }.`,
    };
  },
});
