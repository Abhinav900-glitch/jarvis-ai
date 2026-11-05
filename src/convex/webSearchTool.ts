"use node";

// ---------------------------------------------------------------------------
// Web search for the agent.
//
// The agent works in a workspace of files, which is enough to fix code and no
// use at all for a question whose answer lives outside it. This is the node
// action behind the `search_web` tool: it searches the live web and hands back
// titles, URLs and excerpts, so the answer is built on what a page says rather
// than on what the model remembers.
//
// Why an action rather than a fetch in the executor: `agentExec` runs in the
// default runtime, where `process.env` secrets are not readable, and the search
// providers are key-gated. The provider chain itself is not rebuilt here — it
// is the same one Deep Research uses (`webSearch` in ./ai), so a key configured
// for one feature serves both, and the agent cannot drift into a second, worse
// idea of what "searching" means.
//
// The honest part is the ending. With no provider configured and no reachable
// network there is no web to consult, so this returns `ok: false` with a reason
// and the tool tells the model to answer from its own knowledge and say so.
// An agent that silently substitutes memory for evidence is the failure this
// whole path exists to avoid.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { webSearch } from "./ai";

export interface WebHit {
  title: string;
  url: string;
  /** Page text or search-engine excerpt. Empty when the provider gave none. */
  snippet: string;
}

interface SearchPayload {
  ok: boolean;
  /** Which source answered: a provider name, "wikipedia", or "" for none. */
  provider: string;
  hits: WebHit[];
  /** Why nothing came back. Empty on success. */
  note: string;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Keyless fallback: the Wikipedia search API.
 *
 * Not a general web index, and labelled as Wikipedia in the result so the model
 * can weigh it accordingly — but it is a real, reachable source of factual
 * material with no key and no scraping, which is exactly what a deployment with
 * no search provider configured would otherwise lack.
 */
async function wikipediaSearch(query: string, limit: number): Promise<WebHit[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(limit),
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    exlimit: "max",
    inprop: "url",
    origin: "*",
  });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    // Wikipedia asks for a identifying User-Agent on API traffic, and blocks
    // the default one.
    headers: {
      "User-Agent": "JarvisAgent/1.0 (Convex agent web search)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);

  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        { title?: string; fullurl?: string; extract?: string; index?: number }
      >;
    };
  };

  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((page) => ({
      title: clean(page.title ?? "") || "Untitled result",
      url: page.fullurl ?? "",
      snippet: clean(page.extract ?? "").slice(0, 700),
    }))
    .filter((hit) => hit.url)
    .slice(0, limit);
}

export const search = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<SearchPayload> => {
    const query = args.query.trim();
    const limit = Math.min(Math.max(args.limit ?? 6, 1), 10);
    if (!query) {
      return { ok: false, provider: "", hits: [], note: "the query was empty" };
    }

    // Configured providers first: they are a web index, and Exa and Parallel
    // additionally return page text, which is what makes an answer grounded
    // rather than headline-shaped.
    const notes: string[] = [];
    try {
      const found = await webSearch(query);
      notes.push(...found.errors);
      const hits: WebHit[] = [];
      const seen = new Set<string>();
      for (const source of found.sources) {
        if (!source.url || seen.has(source.url)) continue;
        seen.add(source.url);
        hits.push({
          title: clean(source.title) || "Untitled result",
          url: source.url,
          snippet: clean(source.snippet ?? "").slice(0, 700),
        });
        if (hits.length >= limit) break;
      }
      if (hits.length > 0) {
        return {
          ok: true,
          provider: found.answered.join(" + ") || "web search",
          hits,
          note: "",
        };
      }
    } catch (err) {
      notes.push(err instanceof Error ? err.message : "search failed");
    }

    // No provider answered — either none is configured or every call failed.
    // One keyless source is worth trying before telling the model there is no
    // web, because "no key configured" is not the same as "no network".
    try {
      const hits = await wikipediaSearch(query, limit);
      if (hits.length > 0) {
        return { ok: true, provider: "wikipedia", hits, note: "" };
      }
      notes.push("wikipedia: no matching articles");
    } catch (err) {
      notes.push(`wikipedia: ${err instanceof Error ? err.message : "failed"}`);
    }

    return {
      ok: false,
      provider: "",
      hits: [],
      note: notes.join(" · ").slice(0, 400) || "no search provider is configured",
    };
  },
});
