// ---------------------------------------------------------------------------
// Deck research: turning web search hits into facts a slide writer can use.
//
// A deck that says "costs fell sharply" is a deck nobody can defend in the
// room. So a build can start with one real search, and this is the step that
// turns its results into the handful of sentences the writer is allowed to
// quote — the page's own answer, plus the source to credit.
//
// Kept free of Convex and of the network so the shaping is testable on its own.
// The interesting failures all happen here: eight results from one blog are one
// source, a 4,000-character page is a paragraph nobody reads on a slide, and a
// title that is only a site name credits nobody.
// ---------------------------------------------------------------------------

export interface SearchHitLike {
  title: string;
  url: string;
  domain?: string;
  /** The page text behind the result, when the search provider returns it. */
  snippet?: string;
}

export interface DeckResearch {
  /** Ready-to-quote lines, each ending with its source in brackets. */
  facts: string[];
  /** One entry per fact, for the panel and for the closing slide. */
  sources: { title: string; url: string }[];
}

/** Facts per deck. More than this stops being research and becomes noise. */
const MAX_FACTS = 8;

/** A sentence long enough to stand alone in a bullet. */
const MIN_FACT_CHARS = 40;

/**
 * The floor for a sentence carrying a figure.
 *
 * "Adoption hit 62%." is a better fact than the paragraph around it and is
 * shorter than a readable bullet, so figures get their own, lower bar.
 */
const MIN_FIGURE_CHARS = 20;

/** And short enough that three of them fit on a slide's notes. */
const MAX_FACT_CHARS = 240;

/**
 * The one sentence from a page worth putting on a slide.
 *
 * Exa and Parallel return the page's opening text, which starts with its
 * markdown title ("# On-Device AI Market Size...") followed by the deck's own
 * title again. Fed to a writer unchanged, that becomes a bullet with a hash in
 * it. So the title is stripped, the sentences are split, and the first one that
 * carries a figure wins — a figure is what makes a claim checkable, and it is
 * rare for the first sentence of a page to be the interesting one.
 */
function evidence(text: string, title: string): string {
  const clean = text.replace(/^[#>*\s|]+/, "").replace(/\s+/g, " ").trim();
  const bareTitle = title.replace(/^[#>*\s|]+/, "").trim();
  // The title can repeat: several crawlers put the heading in, then the
  // page's own `<title>` again. Three passes cover the shapes seen in a real
  // search; beyond that the text is not a heading and stripping would eat copy.
  let body = clean;
  for (let guard = 0; guard < 3; guard += 1) {
    if (!bareTitle || !body.startsWith(bareTitle)) break;
    body = body.slice(bareTitle.length).replace(/^[\s\-–—:.#|]+/, "").trim();
  }
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim());
  const withFigure = sentences.find(
    (sentence) => /\d/.test(sentence) && sentence.length >= MIN_FIGURE_CHARS,
  );
  const readable = sentences.find((sentence) => sentence.length >= MIN_FACT_CHARS);
  return (withFigure ?? readable ?? body).slice(0, MAX_FACT_CHARS);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/**
 * Shape raw hits into facts.
 *
 * One fact per domain: a search that returns eight pages from the same site has
 * returned one source, and a deck that cites it eight times is worse than one
 * that cites it once. Hits with no body text are dropped rather than promoted
 * from their title — a headline is not evidence.
 */
export function researchFromHits(hits: SearchHitLike[], limit = MAX_FACTS): DeckResearch {
  const facts: string[] = [];
  const sources: { title: string; url: string }[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const url = typeof hit.url === "string" ? hit.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;

    const domain = hit.domain?.trim() || domainOf(url);
    if (!domain || seen.has(domain)) continue;

    const title = (hit.title ?? "").replace(/\s+/g, " ").trim() || domain;
    const text = evidence(hit.snippet ?? "", title);
    if (text.length < MIN_FIGURE_CHARS + 10) continue;

    seen.add(domain);
    facts.push(`${text} [${title.replace(/^[#>*\s|]+/, "").trim() || domain} · ${domain}]`);
    sources.push({ title, url });

    if (facts.length >= limit) break;
  }

  return { facts, sources };
}
