// ---------------------------------------------------------------------------
// Built-in plugin packs.
//
// Settings → Plugins has always taken a zip the user brought themselves. These
// are the ones that come with the app: a small set of skill packs assembled in
// the browser into the same shape an uploaded plugin has
// (`.claude-plugin/plugin.json` + `skills/*.md`), so both paths end up as one
// stored zip with no special cases downstream.
//
// A pack is plain Markdown, which is the point: the user can read every word
// before adding it, download the zip and keep it, or delete it again.
// ---------------------------------------------------------------------------

import { buildZip } from "./zip-write";
import { CATALOG, skillBodyFor } from "./plugin-catalog";

export interface PluginPresetSkill {
  /** File name inside `skills/`, without the extension. */
  slug: string;
  /** Short human title shown in the UI. */
  title: string;
  /** One line explaining when the assistant should reach for it. */
  when: string;
  /**
   * Markdown for the skill. Catalogue entries leave this out and get a body
   * generated from their category and scope when the zip is built, which keeps
   * a 500-entry catalogue cheap to list.
   */
  body?: string;
}

export interface PluginPreset {
  id: string;
  name: string;
  version: string;
  /** Shown in the list row after it is stored. */
  description: string;
  /** One line for the preset card. */
  tagline: string;
  /** Shelf this pack belongs to; used by the picker's filter chips. */
  category: string;
  /** The scope phrase a generated body is written around. */
  focus?: string;
  skills: PluginPresetSkill[];
}

const RESEARCH_BRIEF = `# Research brief

Turn an open question into a brief someone can act on, with every claim
traceable to a source.

## Method

1. **Restate the question** in one sentence, including the scope and the date.
   If the question is ambiguous, say which reading you are answering.
2. **Plan the search.** List the three or four things you actually need to
   know. For each, name the kind of source that would settle it (primary
   document, official changelog, dataset, expert commentary).
3. **Gather, don't conclude.** For every source, record: title, publisher,
   date, and the specific sentence or number being relied on.
4. **Separate the layers.** Facts from primary sources, claims from secondary
   ones, and your own inference. Never let the third pose as the first.
5. **Resolve conflicts openly.** If two credible sources disagree, say so and
   give the likely reason (different definitions, different dates, different
   populations).
6. **Close with what is still unknown.** A brief that admits its gaps is more
   useful than one that pretends to be complete.

## Output shape

- **Answer** — two or three sentences, direct.
- **Key findings** — bullet points, each with a citation.
- **Caveats** — what would change the answer.
- **Sources** — numbered, with dates and links.

## Rules

- Never invent a citation, a date, a quotation or a statistic. If you could not
  verify something, write "not verified" instead of a number.
- Prefer the primary source over the summary of it, and the newest version of a
  document over an older copy.
- When the question is about something that changes quickly (prices, versions,
  policy), state how current the answer is.
`;

const CODE_REVIEW = `# Code review

Review a change for the things that break in production, in the order they
break.

## Order of attention

1. **Correctness** — does it do what it claims for the inputs it will really
   see? Look for off-by-one, empty collections, null/undefined, timezone and
   locale assumptions, and retries that duplicate work.
2. **Failure behaviour** — what happens when the network, the database or the
   third-party API fails? Are errors swallowed, surfaced, or retried forever?
3. **Concurrency and state** — double submits, races between an optimistic
   update and a refetch, effects that run twice, stale closures.
4. **Security** — untrusted input reaching a query, a shell, a template or a
   file path; secrets in logs; authorisation checked on the object, not only on
   the route.
5. **Data** — migrations that are reversible, indexes for the new query, fields
   that can be absent in existing rows.
6. **Clarity** — names that say what the thing is, functions that do one thing,
   comments only where the code cannot say it itself.

## How to write the review

- Lead with the blocking issues, each as: file and line, what breaks, and the
  smallest fix.
- Separate **must fix** from **worth doing** from **nit**. Never bury a bug
  under style notes.
- Quote the code you are talking about, briefly.
- If the change is sound, say so plainly and name the risk you checked.

## What not to do

- Do not rewrite the author's style to your own taste.
- Do not ask for tests that the repository does not already run, unless the
  missing test is the actual risk.
- Do not approve to be agreeable. An unexamined approval is worse than a slow
  review.
`;

const WRITING_POLISH = `# Writing polish

Edit prose so it says more with fewer words, without flattening the voice.

## Passes, in order

1. **Structure** — is the first paragraph the point? Does each section earn its
   place? Would a different order be clearer?
2. **Paragraphs** — one idea each. If a paragraph needs "also", it is two
   paragraphs.
3. **Sentences** — cut the throat-clearing ("It is important to note that",
   "In order to", "There are a number of"). Prefer the active voice unless the
   actor is genuinely unknown.
4. **Words** — replace abstractions with the concrete noun. Delete adverbs
   doing work the verb should do.
5. **Rhythm** — vary sentence length. A short sentence after two long ones
   lands. Read the result aloud in your head.

## Keep

- The author's vocabulary and quirks. Polish is not homogenisation.
- Technical terms that are precise. Do not trade accuracy for plainness.
- Deliberate repetition used for emphasis.

## Type and emphasis

Formatting is part of the edit, not decoration on top of it.

- **Bold** marks the one sentence a skimming reader must not miss. A paragraph
  with three bold phrases has none.
- *Italic* marks a change of voice: the title of a work, a foreign word, an
  aside, one word that carries the sentence. Never a whole paragraph — slanted
  text is measurably slower to read.
- Serif for body copy that will be read at length — **Cambria** or Georgia on
  screen, Times New Roman only where a format demands it. Sans for headings,
  labels and interface text: Segoe UI, Helvetica, Arial. Monospace for anything
  that must line up.
- Never leave a font without a fallback. Cambria, Georgia, serif survives a
  machine that has never seen Cambria; Cambria on its own does not.
- In Markdown, say the formatting rather than the font — two asterisks for bold
  and one for italic are all the medium carries. Name the family in words when
  the output is going into a document.

Details, and the reasoning per typeface, live in the **Typography** pack.

## Return

Give the edited text first, then a short list of what changed and why — not a
line-by-line diff unless the user asks for one. If a change alters meaning,
flag it explicitly rather than folding it in silently.
`;

const TYPOGRAPHY = `# Typography

Choose the face, weight and spacing for the page the text will actually be
read on.

## Families, and what each is for

- **Serif for body copy.** Cambria, Georgia, Charter, Source Serif. Cambria and
  Georgia share a large x-height and sturdy serifs, which is why they hold up at
  small sizes on a screen; Cambria is the safer one inside a Word document.
- **Sans for headings, labels and interfaces.** Segoe UI, Helvetica, Arial,
  Inter. At 12–14px a sans keeps its shape where a light serif thins out.
- **Monospace for anything that must line up.** Consolas, Courier New, JetBrains
  Mono: code, digit tables, tokens, IDs.
- **Times New Roman is a print face.** It was cut for ink spread on paper; on a
  screen it goes spindly. Use it when a submission format demands it, not
  because it is the default.

## The styles, and what each one means

- *Italic* — a change of voice: titles of works, foreign words, a term being
  discussed rather than used, an aside. A phrase at a time.
- **Bold** — hierarchy: the term being defined, the decision, the number that
  matters. Weight is a spotlight, and two spotlights mean none.
- **Small caps or capitals** — headings and labels, never running text.
- Underline — a link on the web; emphasis only in print, where nothing clicks.
- Strike — text that was withdrawn, never a way to disagree with it.

## Numbers that hold up

- Body copy 16–18px on screen, 10–12pt in print; line-height 1.5–1.65.
- Measure of 45–75 characters per line. Wider and the eye loses the return.
- A heading scale of 1.25 or 1.33 — 16, 20, 25, 31 — reads as one system.
- Larger type needs less line-height; smaller type needs more.
- Space above a heading, not below it: the heading belongs to what follows.

## Pairing

- One serif and one sans, used by role: serif for reading, sans for structure.
  Two serifs, or two sans, compete and neither wins.
- The pair should differ in more than weight — a real contrast in width or
  skeleton, not Cambria beside Georgia.
- One family used well beats three used decoratively.

## Handing it over

- **Markdown carries no fonts.** Bold is two asterisks either side of a word
  and italic is one. Name the
  family in words — "set the body in Cambria 11pt" — instead of pretending the
  markup carries it.
- **HTML and email** get a stack that ends in a generic family:
  font-family: Cambria, Georgia, serif; font-style: italic; font-weight: 700;
- **Word and Google Docs** get the style name, not the look: "Heading 2", "Body
  Text, Cambria 11pt, first line italic". Named styles survive a re-style;
  manual formatting does not.
- Never ship a font the reader may not have without a fallback behind it.

## Check before returning

- Read the body copy at the size it will be read at, not zoomed out.
- Count the bold phrases and the italics. Each should justify itself; three in
  one paragraph means two should go.
- Every font stack ends in serif, sans-serif or monospace.
- Lines land between 45 and 75 characters at the intended width.
`;

const TEXT_FORMATTING = `# Text formatting

Use the lightest formatting that carries the meaning. If the words are right,
formatting is punctuation; if they are not, no amount of weight fixes them.

## What each control means

- **Bold** — hierarchy. The term being introduced, the one-sentence answer, the
  warning. One per section is usually enough.
- *Italic* — voice. Titles, foreign terms, a word being discussed rather than
  used, an aside. Whole italic paragraphs belong to prefaces and quotations.
- Strikethrough — a revision the reader is meant to see withdrawn. Not a way to
  edit someone else's opinion.
- Underline — links on screen. In print, where nothing clicks, it can carry
  emphasis, but then assert it once.
- Highlight — last resort, for a document being worked on rather than read.
- Code formatting — anything the reader would type, or that must not reflow.

## Limits worth keeping

- One emphasis per idea. Bold, italic and underline together read as shouting
  in three languages.
- Do not bold a whole paragraph; bold the sentence that is its point.
- Emphasis lands hardest at the end of a sentence. Mid-sentence it interrupts;
  at the end it concludes.
- Capitals are not emphasis — they are a different voice, and a loud one.
- Punctuation carries hierarchy too: a colon before a list, a dash for an aside,
  a full stop instead of a semicolon when the sentence has run long.

## Per medium

- **Chat and Markdown** — two asterisks for bold, one for italic, two tildes
  for strikethrough, hashes for a heading, plus lists, tables and blockquotes.
  Nothing beyond that survives reliably.
- **HTML** — the semantic tags: strong, em, del, code. An inline style only
  when a font genuinely has to be set, and then with a fallback stack.
- **Email** — bold and italic survive most clients; custom fonts rarely do, and
  Outlook ignores much of anything modern.
- **Word and Google Docs** — named styles first (Title, Heading 1, Body Text),
  direct formatting only for a one-off.

## Check before returning

- Strip every marker: does the meaning survive? If not, the words need work.
- Count the bold spans per paragraph. More than one needs justifying.
- No emphasis carried by capitals alone.
- Nothing important is conveyed only by colour or by strikethrough.
`;

const DATA_ANALYSIS = `# Data and numbers

Work through quantitative questions so the arithmetic is checkable and the
units never drift.

## Method

1. **State the quantity** you are computing, with its unit, before any numbers.
2. **List the inputs** with their sources and units. Convert to one unit system
   up front and say which one.
3. **Estimate first.** A rough order of magnitude tells you when the precise
   answer is wrong.
4. **Show the calculation** step by step, keeping units attached. Units that
   do not cancel are a mistake, not a detail.
5. **Sanity-check** against a known reference: is the result plausible for the
   scale of the thing being measured?
6. **State precision honestly.** Do not print eight significant figures from
   inputs with two.

## Common traps

- Percentages of percentages, and percentage points versus percent change.
- Averages of averages; medians reported as means.
- Mixing nominal and real values, or currencies at different dates.
- Base rates ignored when interpreting a test or a rate.
- Survivorship in the sample: what is missing from the data.

## Output

Give the answer, then the working, then the assumptions. If an assumption
dominates the result, say so before the number.
`;

const DOC_EXPLAINER = `# Explain a document

Take a long or dense document and produce an explanation a busy reader can use.

## Method

1. **Identify the type** — contract, spec, paper, policy, changelog, manual —
   because each hides its important parts in a different place.
2. **Find the operative sentences.** In a contract, the ones that create an
   obligation ("shall", "must", "may not"). In a spec, the normative ones. In a
   paper, the claim and the evidence for it.
3. **Summarise in three layers**: one paragraph, then five bullets, then the
   details that matter for the reader's stated purpose.
4. **Surface the traps** — deadlines, auto-renewal, exceptions, definitions
   that quietly narrow a promise, and anything the document says it may change
   later.
5. **Mark what is not there.** A missing clause is often the finding.

## Rules

- Quote sparingly but exactly; a paraphrase of a clause is not the clause.
- Keep the document's own defined terms; do not substitute synonyms for them.
- Do not give legal, medical or financial advice — describe what the document
  says and what a reader should ask a professional.
`;

/**
 * The four hand-written packs. They carry full skill bodies, several skills
 * each, and read the way a person would write them.
 */
const EDITORIAL_PACKS: PluginPreset[] = [
  {
    id: "research-brief",
    name: "Research brief",
    category: "Research",
    version: "1.0.0",
    description:
      "Turns an open question into a cited brief and keeps facts, claims and inference apart.",
    tagline: "Cited briefs with the gaps left visible",
    skills: [
      {
        slug: "research-brief",
        title: "Research brief",
        when: "Use for any question that needs sources, dates or a literature scan.",
        body: RESEARCH_BRIEF,
      },
      {
        slug: "doc-explainer",
        title: "Explain a document",
        when: "Use for contracts, specs, papers and policies that need unpacking.",
        body: DOC_EXPLAINER,
      },
    ],
  },
  {
    id: "code-review",
    name: "Code review",
    category: "Engineering",
    version: "1.0.0",
    description:
      "A review order that finds production breakage first and keeps nits where they belong.",
    tagline: "Correctness first, style last, no rubber stamps",
    skills: [
      {
        slug: "code-review",
        title: "Code review",
        when: "Use when reviewing a diff, a PR or a file before shipping.",
        body: CODE_REVIEW,
      },
    ],
  },
  {
    id: "writing-polish",
    name: "Writing polish",
    category: "Writing",
    version: "1.0.0",
    description:
      "Multi-pass editing that cuts filler while keeping the author's voice intact.",
    tagline: "Tighter prose that still sounds like you",
    skills: [
      {
        slug: "writing-polish",
        title: "Writing polish",
        when: "Use for edits, rewrites, cover letters, docs and announcements.",
        body: WRITING_POLISH,
      },
    ],
  },
  {
    id: "typography",
    name: "Typography",
    category: "Writing",
    version: "1.0.0",
    description:
      "Typefaces, weights, italics and spacing chosen for the page the text is read on, with stacks that survive a missing font.",
    tagline: "The right face, weight and spacing for the job",
    skills: [
      {
        slug: "typography",
        title: "Typography",
        when: "Use when choosing fonts, weights, sizes or spacing for a document, deck, page or email.",
        body: TYPOGRAPHY,
      },
      {
        slug: "text-formatting",
        title: "Text formatting",
        when: "Use when deciding what to bold, italicise or strike — and when not to.",
        body: TEXT_FORMATTING,
      },
    ],
  },
  {
    id: "numbers",
    name: "Numbers & units",
    category: "Data",
    version: "1.0.0",
    description:
      "Quantitative working with units kept attached, estimates first and precision stated.",
    tagline: "Arithmetic you can check line by line",
    skills: [
      {
        slug: "data-analysis",
        title: "Data and numbers",
        when: "Use for estimates, unit conversions, percentages and sanity checks.",
        body: DATA_ANALYSIS,
      },
    ],
  },
];

/**
 * The generated shelf: one narrow, single-skill pack per catalogue entry. The
 * skill body is built from the entry's category and scope in `presetFiles`, so
 * this list stays a cheap table of names.
 */
const CATALOG_PACKS: PluginPreset[] = CATALOG.map((entry) => ({
  id: entry.id,
  name: entry.name,
  version: "1.0.0",
  category: entry.category,
  focus: entry.focus,
  description: `${entry.name} — a focused working method for ${entry.focus}.`,
  tagline: entry.focus,
  skills: [
    {
      slug: entry.id,
      title: entry.name,
      when: `Use when the task turns on ${entry.focus}.`,
    },
  ],
}));

/** Everything the picker offers: hand-written packs first, then the shelf. */
export const PLUGIN_PRESETS: PluginPreset[] = [
  ...EDITORIAL_PACKS,
  ...CATALOG_PACKS,
];

/** Shelf labels in display order, for the picker's filter chips. */
export const PLUGIN_CATEGORIES: string[] = [
  ...new Set(PLUGIN_PRESETS.map((p) => p.category)),
];

/** The files a pack expands to, in the order they are written into the zip. */
export function presetFiles(preset: PluginPreset): {
  name: string;
  text: string;
}[] {
  const manifest = {
    name: preset.id,
    version: preset.version,
    description: preset.description,
    author: { name: "Jarvis" },
    skills: preset.skills.map((s) => `skills/${s.slug}.md`),
  };

  const readme = [
    `# ${preset.name}`,
    "",
    preset.description,
    "",
    "## Skills",
    "",
    ...preset.skills.map((s) => `- \`skills/${s.slug}.md\` — ${s.title}: ${s.when}`),
    "",
    "Stored as a zip in Jarvis. Nothing in this pack executes; it is Markdown you",
    "can read, insert into a turn, download, or delete again.",
    "",
  ].join("\n");

  const skills = preset.skills.map((skill) => ({
    name: `skills/${skill.slug}.md`,
    text: [
      "---",
      `name: ${skill.slug}`,
      `title: ${skill.title}`,
      `description: ${skill.when}`,
      "---",
      "",
      skill.body?.trim()
        ? skill.body
        : skillBodyFor({
            name: skill.title,
            focus: preset.focus ?? preset.tagline,
            category: preset.category,
          }),
    ].join("\n"),
  }));

  return [
    { name: ".claude-plugin/plugin.json", text: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "README.md", text: readme },
    ...skills,
  ];
}

/** Build the pack as a real .zip, ready to store or download. */
export function buildPresetZip(preset: PluginPreset): Blob {
  return buildZip(presetFiles(preset));
}
