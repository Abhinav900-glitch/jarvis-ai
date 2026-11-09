/**
 * Turning a web page into something an image generator can use.
 *
 * "Draw this character" or "draw this car" is a request for a *specific*
 * design, and the design lives on a page the user already has in front of
 * them. The page itself is far too long and too full of navigation to put in a
 * prompt, so a model condenses it to the visual essentials first. These are the
 * pure parts of that: the prompt, and the cleanup of whatever comes back —
 * trimmed, de-fenced, capped, and rejected outright if the model answered with
 * a refusal instead of a description.
 */

export const PAGE_BRIEF_MAX = 600;
const PAGE_TEXT_MAX = 4_200;

export const PAGE_BRIEF_SYSTEM_PROMPT = [
  "You read a web page so an image generator can draw its subject accurately.",
  "Reply with 1–3 sentences, under 80 words, describing only what the page says the subject looks like.",
  "",
  "Include, when the page states them:",
  "- the design's defining shapes, colours, materials and patterns",
  "- clothing, equipment or markings that identify it",
  "- the newest or current form, if the page distinguishes versions",
  "",
  "Rules:",
  "- Plain description only: no preamble, no headings, no bullet points, no advice to the reader.",
  "- Never invent details the page does not support; when it does not say, leave it out.",
  "- If the page contains no visual description at all, reply exactly: NOTHING",
  "- If you cannot read the page, reply exactly: NOTHING",
].join("\n");

/** What gets sent to the model: the page, trimmed, with its title for context. */
export function pageBriefPrompt(input: {
  url: string;
  title?: string;
  text: string;
}): string {
  const title = (input.title ?? "").trim();
  const body = input.text.replace(/\s+/g, " ").trim().slice(0, PAGE_TEXT_MAX);
  return (
    `Page: ${input.url}\n` +
    (title ? `Title: ${title}\n` : "") +
    `\nPage text:\n${body}`
  );
}

/**
 * Tidy the model's answer into a clause that can be appended to a prompt.
 *
 * Returns "" for NOTHING and for a refusal, so callers can treat "this page
 * told us nothing" the same as "this page could not be read" — in both cases
 * the picture still gets generated, just without grounding.
 */
export function cleanPageBrief(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  // Fenced code and wrapping quotes are common enough to be worth stripping.
  text = text
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/```$/, "")
    .trim();
  text = text.replace(/^["'“”]+/, "").replace(/["'“”]+$/, "").trim();

  if (/^nothing\b/i.test(text)) return "";
  if (
    /^(?:i (?:can't|cannot|won't|couldn't|am unable)|sorry\b|i'?m sorry\b|as an ai\b|unfortunately\b)/i.test(
      text,
    )
  ) {
    return "";
  }

  // A leading label ("Visual description: …") is the model narrating its own
  // answer rather than answering.
  text = text.replace(/^(?:visual )?(?:description|appearance|summary)\s*:\s*/i, "");
  text = text.replace(/\s+/g, " ").trim();

  if (text.length <= PAGE_BRIEF_MAX) return text;
  // Cut on a sentence boundary near the cap rather than mid-word.
  const clipped = text.slice(0, PAGE_BRIEF_MAX);
  const stop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "));
  return stop > PAGE_BRIEF_MAX * 0.6
    ? clipped.slice(0, stop + 1).trim()
    : clipped.trimEnd();
}

/** Only http(s) pages are worth sending to a reader. */
export function isPageUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || /\s/.test(raw)) return false;
  // Prefixing a scheme is how a bare host is accepted, but it would also turn
  // `mailto:x@y` into a host named mailto — so any non-http scheme is refused
  // before the prefix is added.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (scheme && !/^https?$/i.test(scheme[1])) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch {
    return false;
  }
}

/** The page as a short label: "fandom.com", not the whole URL. */
export function hostLabel(url: string): string {
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./i, "");
    return host || url.trim();
  } catch {
    return url.trim();
  }
}

/** `<title>` out of raw HTML, decoded enough to read. */
export function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return "";
  return match[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
