// ---------------------------------------------------------------------------
// `/places` arguments.
//
// The command reads as a sentence — "/places coffee near Barcelona" — so the
// location has to be split out of it. Only `near` is split: it cannot mean
// anything else, while "in" is ambiguous ("ramen in a bowl", "pizza in Rome")
// and Google Maps already reads "ramen in Tokyo" correctly when it is left in
// the query. Guessing wrong here sends the search somewhere nobody asked about,
// which is worse than one extra word in the query.
//
// Pure and tested because the split decides what the map shows.
// ---------------------------------------------------------------------------

export interface PlaceQuery {
  /** What to look for. */
  query: string;
  /** Where, when the text named one. */
  near?: string;
}

/** A trailing location clause: " near X". */
const NEAR = /\s+near\s+(.{2,})$/i;

/**
 * Split "/places coffee near Barcelona" into its two halves.
 *
 * Returns `query` only when there is no location clause, or when removing it
 * would leave nothing to search for — "near Lisbon" is a location without a
 * subject, and treating it as a query would search for a café called "near".
 */
export function splitPlaceQuery(args: string): PlaceQuery {
  const text = args.trim().replace(/\s+/g, " ");
  if (!text) return { query: "" };

  const match = text.match(NEAR);
  if (match) {
    const query = text.slice(0, match.index).trim();
    const near = match[1].trim();
    if (query && near) return { query, near };
  }
  return { query: text };
}
