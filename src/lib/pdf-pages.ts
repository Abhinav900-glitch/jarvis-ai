// ---------------------------------------------------------------------------
// Turning a PDF's per-page text into something a model can cite.
//
// Two decisions live here, and both are about honesty rather than format:
//
//   1. Every page is tagged `[page N]` before it is sent, so a citation is
//      copied from a marker rather than invented from context.
//   2. When the document does not fit the budget, whole pages are dropped from
//      the end. A page that is missing is visibly missing; text sliced
//      mid-sentence looks complete and is not.
// ---------------------------------------------------------------------------

export interface PageContext {
  /** The tagged document, ready to drop between <document> tags. */
  text: string;
  /** Page text actually included, in order. Page N is `kept[N - 1]`. */
  kept: string[];
  /** Pages that did not fit, so the caller can say so rather than pretend. */
  dropped: number;
}

/** Default character budget for the tagged document (~15k tokens). */
export const PAGE_CONTEXT_BUDGET = 60_000;

export function buildPageContext(
  pages: string[],
  budget: number = PAGE_CONTEXT_BUDGET,
): PageContext {
  const kept: string[] = [];
  let used = 0;

  for (const raw of pages) {
    // PDFs arrive with hard-wrapped lines and stray spaces; a model reading
    // "the  quick brown" learns nothing useful from the break.
    const page = raw.replace(/\s+/g, " ").trim();
    const block = `[page ${kept.length + 1}] ${page}`;
    if (used + block.length > budget) break;
    kept.push(page);
    used += block.length + 2;
  }

  const text = kept
    .map((page, index) => `[page ${index + 1}] ${page}`)
    .join("\n\n");

  return { text, kept, dropped: pages.length - kept.length };
}

/** True when there is nothing readable in the extraction at all. */
export function hasReadableText(pages: string[]): boolean {
  return pages.some((page) => page.trim().length > 0);
}
