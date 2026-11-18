// ---------------------------------------------------------------------------
// Bing Image Creator — a hand-off, not a provider.
//
// Microsoft's image generator (DALL·E 3 behind the site) has no public API: the
// page is UI-only, and the endpoints people script against are its own internal
// ones, which need a signed-in session cookie and stop working without warning.
// So the studio cannot render through it the way it renders through the keyed
// chain, and pretending otherwise would produce a button that fails silently.
//
// What the site does accept is a pre-filled prompt in the address: `?q=` opens
// the creator with that text already in the box. That is what this builds, so
// the hand-off carries the user's wording — description, style, instructions
// and exclusions — instead of dropping them on an empty page to retype it.
// ---------------------------------------------------------------------------

export const BING_CREATOR_URL = "https://www.bing.com/images/create";

/**
 * How much of the prompt the address can usefully carry. The creator's own box
 * stops taking text around this length and relies on the rest being implied,
 * so the cut happens here where it can be described rather than mid-word on
 * the other side of a tab.
 */
export const BING_PROMPT_LIMIT = 480;

/**
 * The creator page with `prompt` in its box, or null when there is nothing to
 * send. Whitespace is collapsed first: a prompt that was typed with newlines is
 * one sentence to Bing, and the query string should say the same thing.
 */
export function bingCreatorUrl(prompt: string): string | null {
  const text = prompt.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const clipped =
    text.length <= BING_PROMPT_LIMIT
      ? text
      : text.slice(0, BING_PROMPT_LIMIT).replace(/\s+\S*$/, "").trim();
  // `FORM=IRPGEN` is the site's own marker for a link that arrives with a
  // prompt; without it the page still opens, but the box comes up empty.
  const params = new URLSearchParams({ q: clipped || text.slice(0, BING_PROMPT_LIMIT), FORM: "IRPGEN" });
  return `${BING_CREATOR_URL}?${params.toString()}`;
}
