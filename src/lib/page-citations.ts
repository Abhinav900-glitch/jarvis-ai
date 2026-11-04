// ---------------------------------------------------------------------------
// Page citations in a document answer.
//
// The model is asked to write `[p. 12]` (or `[pp. 12–14]`) inline. Markdown
// has no way to carry a page target, so before rendering we rewrite those into
// links to a fragment the renderer recognises — which lets the chip open the
// PDF at the cited page instead of being a decoration.
//
// This only runs when a document is attached to the conversation: in ordinary
// prose `[p. 12]` should stay exactly as the author typed it.
// ---------------------------------------------------------------------------

/** Fragment prefix the renderer keys on. Kept in one place, on purpose. */
export const PAGE_FRAGMENT = "#pdf-page-";

/**
 * `[p. 4]`, `[pp. 12-14]`, `[P.7]` → markdown links the renderer can style.
 * Anything else is left untouched, including the existing `[1]` source
 * citations, which a separate transform already handles.
 */
export function linkPageCitations(text: string): string {
  // The negative lookahead keeps this idempotent: a citation that already
  // carries its link is not wrapped a second time.
  return text.replace(
    /\[p{1,2}\.\s?(\d{1,4})(?:\s?[–-]\s?(\d{1,4}))?\](?!\()/gi,
    (_match, start: string, end?: string) => {
      const label = end ? `pp. ${start}–${end}` : `p. ${start}`;
      return `[${label}](${PAGE_FRAGMENT}${start})`;
    },
  );
}

/** The page number inside a citation fragment, or null if it is another link. */
export function pageFromFragment(href: string): string | null {
  if (!href.startsWith(PAGE_FRAGMENT)) return null;
  const page = href.slice(PAGE_FRAGMENT.length);
  return /^\d{1,4}$/.test(page) ? page : null;
}
