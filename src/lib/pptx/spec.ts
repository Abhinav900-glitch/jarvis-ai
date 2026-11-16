// ---------------------------------------------------------------------------
// The deck spec: what a slide is, before it becomes OOXML.
//
// This is the contract between three things that never meet directly — the AI
// that writes content, the panel that previews it, and the renderer that turns
// it into a .pptx. Everything is optional except `kind` and `title`, because a
// model that omits a field should produce a simpler slide, not a broken file:
// every read goes through a normaliser that coerces types, caps lengths and
// drops shapes it cannot draw.
//
// The kinds mirror python-pptx's practical toolbox rather than its object
// model: a title slide is `cover`, a bullet placeholder is `bullets`, a
// `graphic_frame` holding a `table` is `table`, and a native chart part is
// `chart`. That is the vocabulary a person writing `python-pptx` actually uses.
// ---------------------------------------------------------------------------

export type SlideKind =
  | "cover"
  | "agenda"
  | "section"
  | "bullets"
  | "columns"
  | "quote"
  | "stats"
  | "timeline"
  | "table"
  | "chart"
  | "image"
  | "closing";

export const SLIDE_KINDS: SlideKind[] = [
  "cover",
  "agenda",
  "section",
  "bullets",
  "columns",
  "quote",
  "stats",
  "timeline",
  "table",
  "chart",
  "image",
  "closing",
];

/** Slides whose shape is fixed, so the AI should not be asked to invent one. */
export const FIXED_KINDS: SlideKind[] = ["cover", "agenda", "closing"];

export type ChartKind = "column" | "bar" | "line" | "pie" | "doughnut";

export interface Metric {
  value: string;
  label: string;
  note?: string;
}

export interface TimelineStep {
  when: string;
  title: string;
  detail?: string;
}

export interface TableData {
  columns: string[];
  rows: string[][];
  caption?: string;
}

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  kind: ChartKind;
  categories: string[];
  series: ChartSeries[];
  caption?: string;
  /** Two-to-four capital units, e.g. "%" — rendered after the axis labels. */
  unit?: string;
}

export interface ColumnBlock {
  heading: string;
  points: string[];
}

export interface ImageBlock {
  /** A data URL. Remote URLs are not fetched: PowerPoint cannot see the app's network. */
  dataUrl?: string;
  caption?: string;
  /** "right" splits the slide; "full" bleeds it behind the text. */
  layout?: "right" | "full";
}

export interface SlideSpec {
  kind: SlideKind;
  title: string;
  /** The eyebrow above the title: section, chapter, or a one-word frame. */
  kicker?: string;
  subtitle?: string;
  body?: string[];
  columns?: ColumnBlock[];
  quote?: { text: string; attribution?: string };
  metrics?: Metric[];
  steps?: TimelineStep[];
  table?: TableData;
  chart?: ChartData;
  image?: ImageBlock;
  /** Speaker notes. PowerPoint shows these in Presenter View. */
  notes?: string;
}

export type TransitionKind = "fade" | "push" | "wipe" | "none";

export interface DeckSpec {
  title: string;
  subtitle?: string;
  author?: string;
  theme: string;
  ratio: "16:9" | "4:3";
  footer?: string;
  transition: TransitionKind;
  slides: SlideSpec[];
}

export interface DeckPlanSlide {
  kind: SlideKind;
  title: string;
  /** Why this slide exists — sent to the writer, never rendered. */
  purpose?: string;
}

export interface DeckPlan {
  title: string;
  subtitle?: string;
  sections: { title: string; intent?: string }[];
  slides: DeckPlanSlide[];
}

export const MAX_SLIDES = 80;
export const MIN_SLIDES = 8;

/**
 * Strip the markdown a model reaches for even when told not to.
 *
 * Only paired emphasis is removed, so `3*4` and a lone asterisk survive — the
 * point is to drop `**bold**` styling that PowerPoint would print literally.
 */
const plain = (value: string): string =>
  value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*\n]+)\*/g, "$1");

const text = (value: unknown, max: number): string => {
  if (typeof value === "number") return String(value).slice(0, max);
  if (typeof value !== "string") return "";
  return plain(value).replace(/\s+/g, " ").trim().slice(0, max);
};

const longText = (value: unknown, max: number): string => {
  if (typeof value !== "string") return "";
  return plain(value).replace(/[ \t]+/g, " ").trim().slice(0, max);
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const finite = (value: unknown): number | null => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(/[^0-9.+-]/g, ""))
        : NaN;
  return Number.isFinite(n) ? n : null;
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
};

/** Strip the decoration a model puts around JSON: fences, prose, trailing commas. */
export function extractJson(raw: string): unknown {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1] ?? "", text];
  for (const candidate of candidates) {
    const body = candidate.trim();
    if (!body) continue;
    for (const [open, close] of [
      ["{", "}"],
      ["[", "]"],
    ] as const) {
      const start = body.indexOf(open);
      const end = body.lastIndexOf(close);
      if (start === -1 || end <= start) continue;
      const slice = body.slice(start, end + 1);
      for (const attempt of [slice, slice.replace(/,\s*([}\]])/g, "$1")]) {
        try {
          return JSON.parse(attempt);
        } catch {
          // Try the next shape before giving up.
        }
      }
    }
  }
  return null;
}

function normalizeMetrics(value: unknown): Metric[] {
  return list(value)
    .map((raw): Metric | null => {
      if (raw && typeof raw === "object") {
        const item = raw as Record<string, unknown>;
        const metric = {
          value: text(item.value, 12),
          label: text(item.label ?? item.name, 60),
          note: text(item.note ?? item.detail, 80) || undefined,
        };
        return metric.value && metric.label ? metric : null;
      }
      const line = text(raw, 80);
      if (!line) return null;
      const [head, ...rest] = line.split(/[:\u2014-]/);
      return { value: head.trim().slice(0, 12), label: rest.join(" ").trim() || head.trim() };
    })
    .filter((m): m is Metric => m !== null)
    .slice(0, 4);
}

function normalizeSteps(value: unknown): TimelineStep[] {
  return list(value)
    .map((raw): TimelineStep | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const step = {
        when: text(item.when ?? item.date ?? item.label ?? item.phase, 24),
        title: text(item.title ?? item.name, 60),
        detail: text(item.detail ?? item.note, 100) || undefined,
      };
      return step.title ? step : null;
    })
    .filter((s): s is TimelineStep => s !== null)
    .slice(0, 6);
}

function normalizeColumns(value: unknown): ColumnBlock[] {
  return list(value)
    .map((raw): ColumnBlock | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const heading = text(item.heading ?? item.title, 60);
      const points = list(item.points ?? item.body ?? item.bullets)
        .map((p) => text(p, 180))
        .filter(Boolean)
        .slice(0, 5);
      return heading || points.length ? { heading, points } : null;
    })
    .filter((c): c is ColumnBlock => c !== null)
    .slice(0, 2);
}

function normalizeTable(value: unknown): TableData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const columns = list(item.columns)
    .map((c) => text(c, 40))
    .filter(Boolean)
    .slice(0, 6);
  if (columns.length === 0) return undefined;
  const rows = list(item.rows)
    .map((row) =>
      list(row)
        .map((cell) => text(cell, 80))
        .slice(0, columns.length),
    )
    .filter((row) => row.some(Boolean))
    .slice(0, 8)
    // A short row renders as a blank cell rather than shifting the table left.
    .map((row) => [...row, ...Array(Math.max(0, columns.length - row.length)).fill("")]);
  if (rows.length === 0) return undefined;
  return { columns, rows, caption: text(item.caption, 120) || undefined };
}

function normalizeChart(value: unknown): ChartData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const categories = list(item.categories ?? item.labels)
    .map((c) => text(c, 24))
    .filter(Boolean)
    .slice(0, 8);
  if (categories.length === 0) return undefined;

  const series = list(item.series)
    .map((raw) => {
      if (raw && typeof raw === "object") {
        const s = raw as Record<string, unknown>;
        const values = list(s.values ?? s.data)
          .map((v) => finite(v))
          .filter((v): v is number => v !== null)
          .slice(0, categories.length);
        return values.length ? { name: text(s.name, 30) || "Series", values } : null;
      }
      const values = list(raw)
        .map((v) => finite(v))
        .filter((v): v is number => v !== null);
      return values.length ? { name: "Series", values } : null;
    })
    .filter((s): s is ChartSeries => s !== null)
    .slice(0, 3);

  // A bare array of numbers is a chart, not an error: treat it as one series.
  const single = list(item.values)
    .map((v) => finite(v))
    .filter((v): v is number => v !== null);
  if (series.length === 0 && single.length > 0) {
    series.push({ name: text(item.name, 30) || "Series", values: single });
  }
  if (series.length === 0) return undefined;

  for (const s of series) {
    // A pie cannot carry a missing slice; a column chart can carry a gap.
    while (s.values.length < categories.length) s.values.push(0);
  }

  return {
    kind: oneOf<ChartKind>(item.kind ?? item.type, ["column", "bar", "line", "pie", "doughnut"], "column"),
    categories,
    series,
    caption: text(item.caption, 120) || undefined,
    unit: text(item.unit, 6) || undefined,
  };
}

function normalizeImage(value: unknown): ImageBlock | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const dataUrl = typeof item.dataUrl === "string" && /^data:image\/(png|jpe?g|gif);base64,/i.test(item.dataUrl)
    ? item.dataUrl
    : undefined;
  const caption = text(item.caption, 160) || undefined;
  const layout = item.layout === "full" ? "full" : "right";
  return dataUrl || caption ? { dataUrl, caption, layout } : undefined;
}

/** Coerce one model-authored object into a slide, or nothing if it is unusable. */
export function normalizeSlide(raw: unknown): SlideSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const kind = oneOf<SlideKind>(item.kind ?? item.type, SLIDE_KINDS, "bullets");
  const title = longText(item.title ?? item.heading, 140);
  if (!title && kind !== "quote") return null;

  const body = list(item.body ?? item.bullets ?? item.points)
    .map((line) => text(line, 260))
    .filter(Boolean)
    .slice(0, 7);

  const quoteRaw = item.quote;
  const quote =
    quoteRaw && typeof quoteRaw === "object"
      ? (() => {
          const q = quoteRaw as Record<string, unknown>;
          const qText = longText(q.text ?? q.quote, 400);
          return qText
            ? { text: qText, attribution: text(q.attribution ?? q.author, 80) || undefined }
            : undefined;
        })()
      : typeof quoteRaw === "string" && quoteRaw.trim()
        ? { text: longText(quoteRaw, 400) }
        : undefined;

  const slide: SlideSpec = {
    kind,
    title: title || "A closing thought",
    kicker: text(item.kicker ?? item.eyebrow ?? item.section, 40) || undefined,
    subtitle: longText(item.subtitle, 220) || undefined,
    body,
    columns: normalizeColumns(item.columns),
    quote,
    metrics: normalizeMetrics(item.metrics ?? item.stats),
    steps: normalizeSteps(item.steps ?? item.timeline),
    table: normalizeTable(item.table),
    chart: normalizeChart(item.chart),
    image: normalizeImage(item.image),
    notes: longText(item.notes ?? item.speakerNotes, 1200) || undefined,
  };

  return fitSlideKind(slide);
}

/**
 * A kind the content cannot support falls back to the shape it can.
 *
 * An empty table frame or a chart with no series is a hole in the design that
 * the user would have to fix by hand, so the slide becomes a bullet slide —
 * the layout that can hold almost anything — instead.
 */
export function fitSlideKind(input: SlideSpec): SlideSpec {
  const slide: SlideSpec = { ...input };
  if (slide.kind === "table" && !slide.table) slide.kind = "bullets";
  if (slide.kind === "chart" && !slide.chart) slide.kind = "bullets";
  if (slide.kind === "columns" && (slide.columns ?? []).length === 0) slide.kind = "bullets";
  if (slide.kind === "stats" && (slide.metrics ?? []).length === 0) slide.kind = "bullets";
  if (slide.kind === "timeline" && (slide.steps ?? []).length === 0) slide.kind = "bullets";
  if (slide.kind === "quote" && !slide.quote) slide.kind = "bullets";
  if (slide.kind === "image" && !slide.image) slide.kind = "bullets";
  return slide;
}

/** True when a slide has something to draw beyond its title. */
export function hasContent(slide: SlideSpec): boolean {
  if (["cover", "closing", "section", "agenda"].includes(slide.kind)) return true;
  return Boolean(
    (slide.body ?? []).length ||
      (slide.columns ?? []).length ||
      slide.quote ||
      (slide.metrics ?? []).length ||
      (slide.steps ?? []).length ||
      slide.table ||
      slide.chart ||
      slide.image ||
      slide.subtitle,
  );
}

/** The model's `{ slides: [...] }` envelope, or a bare array, as slides. */
export function normalizeSlides(raw: unknown): SlideSpec[] {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const items = Array.isArray(body.slides)
    ? body.slides
    : Array.isArray(body.cards)
      ? body.cards
      : Array.isArray(raw)
        ? raw
        : [];
  return items
    .map(normalizeSlide)
    .filter((slide): slide is SlideSpec => slide !== null);
}

/** Coerce a whole authored deck, keeping the caller's theme and ratio. */
export function normalizeDeck(raw: unknown, theme = "obsidian"): DeckSpec {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const slides = list(item.slides ?? item.cards)
    .map(normalizeSlide)
    .filter((s): s is SlideSpec => s !== null)
    .slice(0, MAX_SLIDES);
  return {
    title: longText(item.title, 140) || "Untitled deck",
    subtitle: longText(item.subtitle, 220) || undefined,
    author: text(item.author, 80) || undefined,
    theme,
    ratio: item.ratio === "4:3" ? "4:3" : "16:9",
    footer: text(item.footer, 80) || undefined,
    transition: oneOf<TransitionKind>(item.transition, ["fade", "push", "wipe", "none"], "fade"),
    slides,
  };
}

export function normalizePlan(raw: unknown, fallbackTitle: string, count: number): DeckPlan {
  const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sections = list(item.sections)
    .map((raw): { title: string; intent?: string } | null => {
      if (typeof raw === "string") return { title: text(raw, 60) };
      if (!raw || typeof raw !== "object") return null;
      const s = raw as Record<string, unknown>;
      const title = text(s.title ?? s.name, 60);
      return title ? { title, intent: text(s.intent ?? s.purpose, 160) || undefined } : null;
    })
    .filter((s): s is { title: string; intent?: string } => s !== null)
    .slice(0, 10);

  const slides = list(item.slides ?? item.outline)
    .map((raw): DeckPlanSlide | null => {
      if (!raw || typeof raw !== "object") return null;
      const s = raw as Record<string, unknown>;
      const title = text(s.title ?? s.heading, 140);
      if (!title) return null;
      return {
        kind: oneOf<SlideKind>(s.kind ?? s.type, SLIDE_KINDS, "bullets"),
        title,
        purpose: text(s.purpose ?? s.intent ?? s.summary, 200) || undefined,
      };
    })
    .filter((s): s is DeckPlanSlide => s !== null)
    .slice(0, count);

  return {
    title: text(item.title, 140) || fallbackTitle,
    subtitle: text(item.subtitle, 220) || undefined,
    sections,
    slides,
  };
}

// ---------------------------------------------------------------------------
// A deck that needs no model
//
// Every AI step has a deterministic stand-in. That is not a nicety: the panel
// must produce a .pptx even with no provider keys or every model down, and a
// fallback that writes three generic slides would make the whole feature look
// broken at exactly the moment the user is evaluating it.
//
// Illustrative numbers are captioned as such. A fabricated figure presented as
// a fact is the one thing a template must not do.
// ---------------------------------------------------------------------------

/** A tiny deterministic PRNG, so the same topic always draws the same shape. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const SECTION_INTENTS = [
  "the case for paying attention",
  "what is true today",
  "where the leverage is",
  "what to do next",
  "risks worth naming",
  "how this gets measured",
];

export function fallbackPlan(topic: string, count: number): DeckPlan {
  const clean = topic.replace(/\s+/g, " ").trim().slice(0, 140) || "Untitled topic";
  const short = clean.length > 64 ? `${clean.slice(0, 61)}…` : clean;
  const wanted = Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, count));
  // Cover, agenda and closing are three of the slides; the rest is divided into
  // sections of three, which is the shortest run that still reads as a section.
  const sectionCount = Math.max(2, Math.min(5, Math.floor((wanted - 3) / 3)));
  const perSection = Math.max(2, Math.floor((wanted - 3) / sectionCount));
  const labels = ["Context", "Approach", "Evidence", "Roadmap", "Outlook", "Risks"];
  const sections = Array.from({ length: sectionCount }, (_, i) => ({
    title: `${labels[i % labels.length]}`,
    intent: SECTION_INTENTS[i % SECTION_INTENTS.length],
  }));

  const slides: DeckPlanSlide[] = [
    { kind: "cover", title: short, purpose: "Title slide" },
    { kind: "agenda", title: "What this deck covers", purpose: "Agenda from the sections" },
  ];
  sections.forEach((section, s) => {
    slides.push({
      kind: "section",
      title: section.title,
      purpose: `Open the ${section.title.toLowerCase()} section`,
    });
    for (let i = 0; i < perSection; i += 1) {
      const shapes: SlideKind[] = ["bullets", "stats", "columns", "table", "chart", "timeline", "quote"];
      slides.push({
        kind: shapes[(s + i) % shapes.length],
        title: `${section.title}: ${["the essentials", "what the numbers say", "two readings", "side by side", "the trend", "how it unfolds", "in one line"][i % 7]}`,
        purpose: `${section.title} — ${section.intent ?? "key points"}`,
      });
    }
  });
  slides.push({ kind: "closing", title: "Thank you", purpose: "Close and invite questions" });

  // Trim from the middle: a deck that loses its closing is a deck that stops
  // mid-sentence, and the cover is the slide the outline was built around.
  const trimmed =
    slides.length > wanted
      ? [slides[0], ...slides.slice(1, Math.max(1, wanted - 1)), slides[slides.length - 1]]
      : slides;
  return {
    title: short,
    subtitle: `A working deck on ${clean}`,
    sections,
    slides: trimmed.slice(0, wanted),
  };
}

/** Deterministic slide content for one planned slide. */
export function fallbackSlide(planned: DeckPlanSlide, topic: string, index: number): SlideSpec {
  const rand = seeded(`${planned.title}|${topic}|${index}`);
  const section = planned.kind === "section" ? planned.title : undefined;
  const base: SlideSpec = {
    kind: planned.kind,
    title: planned.title,
    kicker: section ?? planned.purpose?.split("—")[0]?.trim(),
  };

  switch (planned.kind) {
    case "cover":
      return {
        ...base,
        subtitle: `A working deck on ${topic}`,
        notes: `Open by naming the question this deck answers about ${topic}. Give the audience the shape of the argument before the detail.`,
      };
    case "agenda":
      return {
        ...base,
        body: [
          "Where things stand",
          "What the evidence supports",
          "The options on the table",
          "What happens next",
        ],
        notes: "Walk the four beats in under a minute. Flag where you want questions.",
      };
    case "section":
      return {
        ...base,
        subtitle: planned.purpose,
        notes: `Transition slide. One sentence: why ${planned.title.toLowerCase()} comes now.`,
      };
    case "stats":
      return {
        ...base,
        metrics: [
          { value: `${Math.round(40 + rand() * 50)}%`, label: "Share of the work this changes", note: "Illustrative" },
          { value: `${(rand() * 4 + 1).toFixed(1)}×`, label: "Faster on the same input", note: "Illustrative" },
          { value: `${Math.round(3 + rand() * 9)}`, label: "Moving parts removed", note: "Illustrative" },
        ],
        notes: "Three numbers, one point: say the point first, then the figure.",
      };
    case "columns":
      return {
        ...base,
        columns: [
          {
            heading: "What works",
            points: ["Clear ownership", "Short feedback loops", "Measurement before opinion"],
          },
          {
            heading: "What holds it back",
            points: ["Handoffs nobody owns", "Decisions without a deadline", "Tools that disagree"],
          },
        ],
        notes: "Contrast the two columns rather than reading them.",
      };
    case "table":
      return {
        ...base,
        table: {
          columns: ["Option", "Cost", "Time", "Confidence"],
          rows: [
            ["Do nothing", "Low", "None", "High"],
            ["Narrow pilot", "Medium", "6 weeks", "Medium"],
            ["Full rollout", "High", "1 quarter", "Low"],
          ],
          caption: "Illustrative comparison — replace with your own figures.",
        },
        notes: "Point at the row you recommend; do not read the table.",
      };
    case "chart": {
      const kind: ChartKind = rand() > 0.5 ? "column" : "line";
      return {
        ...base,
        chart: {
          kind,
          categories: ["Q1", "Q2", "Q3", "Q4"],
          series: [
            {
              name: "Baseline",
              values: [30, 42, 51, 64].map((v) => Math.round(v + rand() * 8)),
            },
            {
              name: "With the change",
              values: [32, 55, 74, 96].map((v) => Math.round(v + rand() * 10)),
            },
          ],
          caption: "Illustrative trend — replace with your own data.",
        },
        notes: "Say what the gap means, not what the axes say.",
      };
    }
    case "timeline":
      return {
        ...base,
        steps: [
          { when: "Now", title: "Baseline", detail: "Measure what happens today." },
          { when: "30 days", title: "Pilot", detail: "One team, one workflow." },
          { when: "90 days", title: "Decide", detail: "Keep, change or stop." },
          { when: "Q+1", title: "Scale", detail: "Only if the pilot earned it." },
        ],
        notes: "The dates are a proposal; ask for the real constraints.",
      };
    case "quote":
      return {
        ...base,
        quote: {
          text: `The useful question about ${topic} is not whether it works, but what it costs to keep it working.`,
          attribution: "Working principle",
        },
        notes: "Pause after the line. Let it land before explaining it.",
      };
    case "image":
      return {
        ...base,
        image: {
          caption: "Drop an image onto this slide in the studio, or replace it with a diagram.",
          layout: "right",
        },
        notes: "Describe what the audience should look at, not the file.",
      };
    case "closing":
      return {
        ...base,
        subtitle: "Questions, and the one decision worth making today.",
        notes: "End on the decision. Do not summarise the whole deck again.",
      };
    default:
      return {
        ...base,
        body: [
          `${planned.title} in one sentence`,
          "What the evidence actually shows",
          "The constraint that decides the next step",
          "What changes if we are wrong",
        ],
        notes: `Answer ${planned.title.toLowerCase()} directly, then give the evidence.`,
      };
  }
}

export function fallbackDeck(
  topic: string,
  count: number,
  theme: string,
): DeckSpec {
  const plan = fallbackPlan(topic, count);
  return {
    title: plan.title,
    subtitle: plan.subtitle,
    theme,
    ratio: "16:9",
    transition: "fade",
    slides: plan.slides.map((planned, i) => fallbackSlide(planned, topic, i)),
  };
}

/** The plan's outline, ready for the writer prompt. */
export function outlineForPrompt(plan: DeckPlan): string {
  const sections = plan.sections.map((s, i) => `${i + 1}. ${s.title}${s.intent ? ` — ${s.intent}` : ""}`);
  const slides = plan.slides.map((s, i) => `${i + 1}. [${s.kind}] ${s.title}${s.purpose ? ` — ${s.purpose}` : ""}`);
  return [
    `Title: ${plan.title}`,
    plan.subtitle ? `Subtitle: ${plan.subtitle}` : "",
    sections.length ? `Sections:\n${sections.join("\n")}` : "",
    `Slides:\n${slides.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
