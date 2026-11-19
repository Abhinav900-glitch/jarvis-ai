// ---------------------------------------------------------------------------
// Merging Google AI Mode's citation list into a research run.
//
// AI Mode answers a question and cites the pages it leaned on. The answer is a
// synthesis, which is not evidence; the cited pages are, and their snippets are
// short excerpts the synthesis prompt can actually quote. This is the small
// piece of arithmetic between the two: keep the references that are new, drop
// the ones the run already has, and never exceed the source budget.
//
// A pure function rather than a loop inside `webSearch` because this is the
// part with edge cases — duplicate citations within one response are common,
// and a run that re-cites a page it already has makes the source list look
// richer than it is.
// ---------------------------------------------------------------------------

/** One page AI Mode cited. */
export interface CitedPage {
  title: string;
  url: string;
  snippet: string;
}

/**
 * The references that add something, in the order AI Mode ranked them.
 *
 * `existing` is anything with a URL (the run's sources); `room` is how many
 * more the run can hold. Entries without a URL are dropped rather than turned
 * into a title-only source that cannot be cited.
 */
export function newAiModeSources(
  existing: readonly { url: string }[],
  references: readonly CitedPage[],
  room: number,
): CitedPage[] {
  const capped = Math.max(Math.trunc(room), 0);
  if (capped === 0) return [];

  const known = new Set(existing.map((source) => source.url));
  const added: CitedPage[] = [];
  for (const reference of references) {
    if (added.length >= capped) break;
    const url = reference.url?.trim();
    if (!url || known.has(url)) continue;
    known.add(url);
    added.push({
      // A citation with no title still has an address worth quoting.
      title: reference.title.trim() || url,
      url,
      snippet: reference.snippet,
    });
  }
  return added;
}
