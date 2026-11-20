// ---------------------------------------------------------------------------
// Prompts for the deck writer, and the shaping that happens around the model.
//
// Two rules drive everything here. First, a stage asks for one artefact at a
// time: an outline, then a batch of slides, so a long deck is many small
// generations instead of one that has to fit a token limit. Second, the model
// is asked for JSON and nothing else, and every field it returns is normalised
// afterwards — a prompt is a request, not a guarantee.
//
// The plan-shaping helpers live here too because they are what makes a
// half-followed instruction into a complete deck: the model can forget the
// agenda, and the deck still gets one.
// ---------------------------------------------------------------------------

import {
  MAX_SLIDES,
  MIN_SLIDES,
  type DeckPlan,
  type DeckSpec,
  type SlideKind,
  type SlideSpec,
} from "./spec";

export const KIND_MENU: { kind: SlideKind; use: string }[] = [
  { kind: "bullets", use: "3-5 points on one idea" },
  { kind: "columns", use: "two readings side by side" },
  { kind: "quote", use: "one line worth pausing on" },
  { kind: "stats", use: "3-4 numbers that carry the argument" },
  { kind: "timeline", use: "phases or dates in order" },
  { kind: "table", use: "an honest comparison" },
  { kind: "chart", use: "a trend or a mix, with real numbers" },
  { kind: "image", use: "a visual beat — a real web picture can be attached after writing" },
  { kind: "section", use: "opens a part of the argument" },
];

export const DECK_SYSTEM_PROMPT = [
  "You are a presentation designer and editor. You write decks that hold an argument slide by slide.",
  "You answer with a single JSON object and nothing else: no prose, no code fences, no commentary.",
  "You never invent statistics. If a number is illustrative you say so in the caption or the note.",
  "You write short slide copy: a title is a claim, a bullet is one line a presenter can say.",
].join(" ");

export interface DeckBrief {
  topic: string;
  slideCount: number;
  tone?: string;
  audience?: string;
  /**
   * Facts from one live web search, each already ending with its source.
   *
   * The writer is allowed to quote these and nothing else that looks like a
   * figure: a deck with a made-up percentage is worse than a deck without one,
   * because the number is the part the room remembers.
   */
  research?: string[];
}

/** The research block both prompts share, or nothing when there was no search. */
function researchBlock(research: string[] | undefined): string[] {
  if (!research || research.length === 0) return [];
  return [
    "Research notes from a live web search — these are the only figures you may quote:",
    ...research.map((fact) => `- ${fact}`),
    "Use them where they fit the argument. If a note disagrees with the outline, the note wins.",
  ];
}

/**
 * Ask for one slide again.
 *
 * The current slide is included as JSON so the model edits this deck's voice,
 * not a generic one, and the kind is pinned: a rewrite of a chart slide that
 * comes back as bullets would be a different slide, not a rewrite.
 */
export function rewriteSlidePrompt(args: {
  deckTitle: string;
  total: number;
  index: number;
  slide: SlideSpec;
  instruction?: string;
}): string {
  const instruction = args.instruction?.trim();
  return [
    `Rewrite slide ${args.index + 1} of ${args.total} in the deck "${args.deckTitle}".`,
    instruction
      ? `The author asked for: ${instruction}`
      : "Tighten it: shorter title, sharper bullets, no filler or throat-clearing.",
    `Current slide JSON:\n${JSON.stringify(args.slide)}`,
    `Return exactly one JSON object using the same keys and the same "kind" ("${args.slide.kind}"). Keep everything that kind needs: a chart keeps its chart, a table keeps its table, a QR slide keeps its url.`,
    "Match the language and voice of the rest of the deck. Plain text only — no markdown, no code fences, no commentary.",
  ].join("\n\n");
}

export function outlinePrompt(brief: DeckBrief): string {
  const tone = brief.tone?.trim() || "clear and confident";
  const audience = brief.audience?.trim() || "an informed general audience";
  return [
    `Plan a ${brief.slideCount}-slide deck about: ${brief.topic}`,
    `Audience: ${audience}. Tone: ${tone}.`,
    ...(researchBlock(brief.research).length
      ? ["", ...researchBlock(brief.research), "Plan a slide that carries each of the strongest notes."]
      : []),
    "",
    "Return only JSON with this shape:",
    '{"title":"deck title","subtitle":"one line","sections":[{"title":"section name","intent":"what it argues"}],"slides":[{"kind":"cover|agenda|section|bullets|columns|quote|stats|timeline|table|chart|image|closing","title":"slide title","purpose":"why this slide exists"}]}',
    "",
    "Rules:",
    `- Exactly ${brief.slideCount} slides in "slides", in presentation order.`,
    "- The first slide is kind cover, the second is kind agenda, the last is kind closing.",
    "- Put a kind section slide before each part of the argument.",
    `- For the middle slides, choose the kind that suits the content: ${KIND_MENU.map((k) => `${k.kind} (${k.use})`).join("; ")}.`,
    "- Never use the same kind for more than two slides in a row.",
    "- Titles are specific claims, not labels. \"Costs fell 40% in two years\", not \"Costs\".",
    "- When research notes are given, at least one title must state the finding they support.",
    "- Between 2 and 6 sections. No markdown, no numbering inside the titles.",
  ].join("\n");
}

export function slidesPrompt(
  brief: DeckBrief,
  plan: DeckPlan,
  batch: { index: number; kind: SlideKind; title: string; purpose?: string }[],
): string {
  const request = batch
    .map(
      (slide, i) =>
        `${i + 1}. kind="${slide.kind}" title="${slide.title}"${slide.purpose ? ` purpose="${slide.purpose}"` : ""}`,
    )
    .join("\n");
  const sections = plan.sections.map((s) => `- ${s.title}${s.intent ? `: ${s.intent}` : ""}`).join("\n");

  return [
    `Write the copy for these slides of a deck about: ${brief.topic}`,
    brief.audience ? `Audience: ${brief.audience}.` : "",
    brief.tone ? `Tone: ${brief.tone}.` : "",
    `The deck's argument: ${plan.title}${plan.subtitle ? ` — ${plan.subtitle}` : ""}`,
    sections ? `Sections:\n${sections}` : "",
    ...(researchBlock(brief.research).length ? ["", ...researchBlock(brief.research)] : []),
    "",
    "Slides to write, in this order:",
    request,
    "",
    "Return only JSON:",
    '{"slides":[{"kind":"...","title":"...","kicker":"...","subtitle":"...","body":["..."],"columns":[{"heading":"...","points":["..."]}],"quote":{"text":"...","attribution":"..."},"metrics":[{"value":"...","label":"...","note":"..."}],"steps":[{"when":"...","title":"...","detail":"..."}],"table":{"columns":["..."],"rows":[["..."]],"caption":"..."},"chart":{"kind":"column|bar|line|pie|doughnut","categories":["..."],"series":[{"name":"...","values":[1,2]}],"caption":"...","unit":"%"},"notes":"..."}]}',
    "",
    "Rules:",
    "- One object per slide, same order and same kind as requested. Keep the requested kind; do not switch it.",
    "- Fill only the fields that kind needs. Be detailed, not padded: a slide is finished when the argument is.",
    "- body: 4-6 points, 8-22 words each, each one a claim with its evidence, no leading bullet characters.",
    "- Use the research notes for any figure. A number that is not in them must be marked illustrative in its note.",
    "- notes: name the source once when a slide leans on a research note, so the presenter can credit it.",
    "- quote: one sentence, plus who said it when that is known.",
    "- metrics: 3 or 4; value at most 6 characters; add note \"illustrative\" if the figure is a placeholder.",
    "- steps: 3-5 phases; when is a date or a horizon.",
    "- table: 3-5 columns, 3-6 rows, every row the same length.",
    "- chart: at most 6 categories, at most 2 series, values as numbers, caption says what the chart shows.",
    "- notes: 2-3 sentences the presenter actually says, including one thing to point at.",
    "- No markdown and no code fences. Never invent a specific statistic you cannot support; mark it illustrative.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Make a plan presentable.
 *
 * A model usually returns the right shape, but a missing agenda or an absent
 * closing is a visible hole rather than a small omission, so those are added
 * here instead of being hoped for. The slide count is honoured in both
 * directions: extra slides are dropped from the middle, and a plan that comes
 * back far too short is replaced wholesale by the deterministic one.
 */
export function alignPlan(plan: DeckPlan, brief: DeckBrief): DeckPlan {
  const wanted = Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, brief.slideCount));
  const slides = [...plan.slides];
  if (slides.length < Math.max(5, Math.floor(wanted * 0.6))) return plan;

  const isKind = (index: number, kind: SlideKind) => slides[index]?.kind === kind;
  if (!isKind(0, "cover")) {
    slides.unshift({ kind: "cover", title: plan.title, purpose: "Title" });
  }
  if (!isKind(1, "agenda")) {
    slides.splice(1, 0, { kind: "agenda", title: "What this deck covers", purpose: "Agenda" });
  }
  if (slides[slides.length - 1]?.kind !== "closing") {
    slides.push({ kind: "closing", title: "Thank you", purpose: "Close" });
  }

  // Two identical kinds in a row read as a list of lists; the second becomes
  // the plainest layout that still fits its content.
  for (let i = 2; i < slides.length - 1; i += 1) {
    if (slides[i].kind === slides[i - 1].kind && slides[i].kind === "bullets") {
      slides[i] = { ...slides[i], kind: i % 2 === 0 ? "columns" : "quote" };
    }
  }

  if (slides.length > wanted) {
    const middle = slides.slice(1, -1);
    const keep = Math.max(0, wanted - 2);
    slides.splice(1, middle.length, ...middle.slice(0, keep));
  }

  return { ...plan, slides: slides.slice(0, wanted) };
}

/** Notes for a deck whose writer never produced them, so Presenter View is never blank. */
export function fallbackNotes(slide: SlideSpec, topic: string): string {
  const lead =
    slide.kind === "cover"
      ? `Open by naming the question this deck answers about ${topic}.`
      : slide.kind === "section"
        ? "This is a transition: one sentence on why this part comes now."
        : slide.kind === "closing"
          ? "End on the decision, not on a summary."
          : `Say what "${slide.title}" means for ${topic} before reading anything on the slide.`;
  const detail = slide.body?.length
    ? `Point at: ${slide.body[0].replace(/\*\*/g, "").slice(0, 120)}.`
    : "Give one concrete example, then move on.";
  return `${lead} ${detail}`;
}

export function deckTitleFor(topic: string): string {
  const clean = topic.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled deck";
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

export type { DeckSpec };
