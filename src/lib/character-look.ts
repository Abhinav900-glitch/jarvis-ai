// ---------------------------------------------------------------------------
// Character references for image generation.
//
// "goku" on its own is a bad prompt: the generator has no idea what he looks
// like, so it invents a man in orange and gets the hair wrong. Naming a
// character is a request for THAT character, so the prompt needs their design
// in words before it goes to the model — hair, eyes, build, outfit and its
// colours, signature props, the art style they come from, and the newest form
// or power they have. That description is researched (web first, model
// knowledge after) and cached, and the pieces below keep it inside the
// generator's limits and out of its way when there is nothing to add.
// ---------------------------------------------------------------------------

/** What `cloudinary.generateImage` accepts; anything longer is rejected. */
export const PROMPT_MAX = 1000;

/** How much of the 1000 characters a look note may take. */
export const LOOK_MAX = 420;

/** A cached look older than this is refreshed, since characters get new forms. */
export const LOOK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cache key for a character. "Ben 10", "ben-10" and "Ben10" are the same
 * subject, and each of them costs a search plus a model call to describe.
 */
export function characterKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 60);
}

/** The query a character is looked up with: design facts, not plot. */
export function lookSearchQuery(name: string): string {
  return `${name} character design appearance outfit colours signature powers latest form`;
}

/**
 * Read the names out of the classifier's answer.
 *
 * Asked for JSON, models answer with JSON about half the time: the rest is a
 * fenced block, a sentence ("This prompt features Goku and Saitama."), or a
 * bullet list. All of those are recovered here rather than costing the user
 * their character references. The cap is deliberately small — one prompt with
 * six characters in it would produce a reference longer than the prompt.
 */
export function parseSubjectNames(raw: string, limit = 2): string[] {
  let text = raw.trim();
  if (!text) return [];

  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value
      .replace(/\s+/g, " ")
      .replace(/^["'“”‘’`*_]+|["'“”‘’`*_]+$/g, "")
      .replace(/[.,;:!?]+$/, "")
      .trim();
    // One or two characters is a fragment ("a", "it"), not a name; anything
    // with a newline is a paragraph the model failed to structure.
    if (name.length < 2 || name.length > 60) return;
    if (/^(?:none|no|n\/a|nothing|null|unknown|characters?)$/i.test(name)) return;
    // Pronouns survive the length check but name nothing.
    if (
      /^(?:a|an|the|it|its|he|she|they|them|him|her|his|this|that|these|those|and|or)$/i.test(
        name,
      )
    ) {
      return;
    }
    const key = characterKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  // 1. JSON, the requested shape: {"names": [...]} or a bare array.
  const jsonStart = text.search(/[[{]/);
  if (jsonStart >= 0) {
    for (const candidate of [text.slice(jsonStart), text.slice(jsonStart, text.lastIndexOf("]") + 1)]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        const list = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && "names" in parsed
            ? (parsed as { names: unknown }).names
            : null;
        if (Array.isArray(list)) {
          list.forEach(push);
          // A valid answer is final even when it is empty: `{"names":[]}`
          // means "no character", and reading the raw JSON as a sentence
          // would invent one out of the key names.
          return out.slice(0, limit);
        }
      } catch {
        // Not JSON. The text fallback below is the whole reason this is lenient.
      }
    }
  }

  // 2. Anything else: one name per line, or a sentence naming them.
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) {
    lines.forEach(push);
  } else if (lines.length === 1) {
    const sentence = lines[0];
    // "This prompt shows Goku and Saitama" — split on the joining words.
    const after = /(?:features?|shows?|depicts?|contains?|characters?:)\s+(.*)$/i.exec(sentence);
    const body = after?.[1] ?? sentence;
    body
      .replace(/\s+and\s+/gi, ", ")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach(push);
  }

  return out.slice(0, limit);
}

/**
 * Reduce the model's reference to one usable line.
 *
 * Returns "" when there is nothing worth adding — a refusal, a restatement of
 * the prompt, or an answer too short to describe anything. The caller treats
 * "" as "generate with the prompt as typed" rather than as an error, because a
 * character lookup that fails must never block the picture.
 */
export function cleanLookBrief(raw: string, prompt = ""): string {
  let text = raw.trim();
  if (!text) return "";
  if (/^(?:i (?:can't|cannot|won't)|sorry\b|i'?m sorry\b|as an ai\b)/i.test(text)) {
    return "";
  }

  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1];

  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:here(?:'s| is)\b|sure[,!]|certainly[,!]|of course[,!])/i.test(line))
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""))
    .join(" ");

  // A label before the description: "Character reference: ...", "Appearance:".
  text = text.replace(
    /^\s*(?:#{1,6}\s*|\*{1,2}\s*)?(?:character\s+)?(?:reference|appearance|look|design)\s*[:\-–—]\s*/i,
    "",
  );
  text = text
    .replace(/^[\s"'“”‘’`*_]+/, "")
    .replace(/[\s"'“”‘’`*_]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > LOOK_MAX) {
    const cut = text.slice(0, LOOK_MAX);
    const lastSpace = cut.lastIndexOf(" ");
    text = (lastSpace > LOOK_MAX * 0.7 ? cut.slice(0, lastSpace) : cut).trim();
  }

  if (text.length < 20) return "";
  // The prompt already says it: appending it again wastes the character budget
  // and makes the model draw the text.
  if (prompt && prompt.toLowerCase().includes(text.toLowerCase())) return "";

  // A trailing full stop is not part of a prompt clause.
  return text.replace(/[.;,]+$/, "").trim();
}

/**
 * Insert the reference into the prompt without breaking the generator's limit.
 *
 * The user's own words lead: a reference is support for what they asked for,
 * not a replacement for it. If the base prompt is already long, the reference
 * is shortened — and dropped entirely if what survives would be too short to
 * be worth reading.
 */
export function composeGroundedPrompt(base: string, look: string): string {
  const clean = base.replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX);
  const reference = look.replace(/\s+/g, " ").trim();
  if (!reference) return clean;
  if (clean.toLowerCase().includes(reference.toLowerCase())) return clean;

  const lead = " Character reference, keep this design recognisable: ";
  const room = PROMPT_MAX - clean.length - lead.length;
  // 60 characters is roughly "short black hair, orange gi" — below that the
  // fragment misleads more than it helps.
  if (room < 60) return clean;

  let body = reference;
  if (body.length > room) {
    const cut = body.slice(0, room);
    const lastSpace = cut.lastIndexOf(" ");
    body = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  }
  if (body.length < 40) return clean;

  return `${clean}${lead}${body.replace(/[.;,]+$/, "")}`;
}
