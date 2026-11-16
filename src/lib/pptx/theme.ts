// ---------------------------------------------------------------------------
// Deck themes.
//
// A theme is the whole visual contract between the spec and the renderer:
// colours, typefaces, the size of a slide title, the corner treatment, and
// which decorative motif the layout draws in the margins. Keeping every value
// in one record means a slide layout never hard-codes a colour, so adding a
// palette is a data change rather than a tour through the renderer.
//
// Hex strings are stored without the leading `#` because that is what OOXML's
// `a:srgbClr val` wants; converting once at the edge is how a stray `#` ends up
// in a file that PowerPoint refuses to open.
// ---------------------------------------------------------------------------

export const THEME_IDS = [
  "obsidian",
  "ivory",
  "ember",
  "tide",
  "moss",
  "carbon",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type Motif = "rings" | "dots" | "rules" | "grid";

export interface DeckTheme {
  id: ThemeId;
  label: string;
  /** One line, shown in the picker: what the deck will feel like. */
  mood: string;
  dark: boolean;
  /** Slide background. */
  bg: string;
  /** Slightly raised panel / card fill. */
  panel: string;
  /** A second panel tone, for alternating table rows and chart bands. */
  panelAlt: string;
  ink: string;
  muted: string;
  accent: string;
  accentAlt: string;
  line: string;
  headFont: string;
  bodyFont: string;
  /** Points, for a 960 x 540 slide. */
  titleSize: number;
  coverSize: number;
  sectionSize: number;
  radius: number;
  motif: Motif;
}

const THEMES: Record<ThemeId, DeckTheme> = {
  obsidian: {
    id: "obsidian",
    label: "Obsidian",
    mood: "Dark graphite, teal signal, engineering review",
    dark: true,
    bg: "0B0F14",
    panel: "151C25",
    panelAlt: "101720",
    ink: "F1F5F9",
    muted: "93A1B2",
    accent: "4FD1C5",
    accentAlt: "F0B429",
    line: "243040",
    headFont: "Segoe UI",
    bodyFont: "Segoe UI",
    titleSize: 33,
    coverSize: 52,
    sectionSize: 40,
    radius: 10,
    motif: "rings",
  },
  ivory: {
    id: "ivory",
    label: "Ivory",
    mood: "Warm paper, serif titles, research brief",
    dark: false,
    bg: "F7F3EC",
    panel: "FFFDF8",
    panelAlt: "EFE9DE",
    ink: "1E1B16",
    muted: "6B6355",
    accent: "A8551A",
    accentAlt: "0F6B63",
    line: "DCD2C2",
    headFont: "Georgia",
    bodyFont: "Calibri",
    titleSize: 32,
    coverSize: 50,
    sectionSize: 38,
    radius: 4,
    motif: "rules",
  },
  ember: {
    id: "ember",
    label: "Ember",
    mood: "Near-black plum, coral heat, pitch deck",
    dark: true,
    bg: "180E12",
    panel: "251419",
    panelAlt: "1E1116",
    ink: "FCEFF2",
    muted: "B99AA3",
    accent: "FF6B6B",
    accentAlt: "FFD166",
    line: "3A2129",
    headFont: "Trebuchet MS",
    bodyFont: "Calibri",
    titleSize: 33,
    coverSize: 53,
    sectionSize: 40,
    radius: 14,
    motif: "grid",
  },
  tide: {
    id: "tide",
    label: "Tide",
    mood: "Deep ocean, cyan light, product walkthrough",
    dark: true,
    bg: "06202B",
    panel: "0C2E3C",
    panelAlt: "0A2733",
    ink: "E8F6F4",
    muted: "8FB3B9",
    accent: "22D3EE",
    accentAlt: "A7F3D0",
    line: "16414F",
    headFont: "Segoe UI",
    bodyFont: "Segoe UI",
    titleSize: 32,
    coverSize: 50,
    sectionSize: 38,
    radius: 16,
    motif: "rings",
  },
  moss: {
    id: "moss",
    label: "Moss",
    mood: "Forest floor, soft green, sustainability",
    dark: true,
    bg: "0F1A14",
    panel: "17261D",
    panelAlt: "132019",
    ink: "ECF5EE",
    muted: "97B3A1",
    accent: "86EFAC",
    accentAlt: "FDE68A",
    line: "24402F",
    headFont: "Georgia",
    bodyFont: "Segoe UI",
    titleSize: 32,
    coverSize: 50,
    sectionSize: 38,
    radius: 8,
    motif: "dots",
  },
  carbon: {
    id: "carbon",
    label: "Carbon",
    mood: "Cool grey, ink-blue accent, client report",
    dark: false,
    bg: "EEF1F5",
    panel: "FFFFFF",
    panelAlt: "E3E8EF",
    ink: "111318",
    muted: "5B6472",
    accent: "2563EB",
    accentAlt: "F97316",
    line: "CDD5DF",
    headFont: "Arial",
    bodyFont: "Calibri",
    titleSize: 33,
    coverSize: 51,
    sectionSize: 39,
    radius: 6,
    motif: "grid",
  },
};

export function themeById(id: string | null | undefined): DeckTheme {
  const key = (id ?? "").trim().toLowerCase() as ThemeId;
  return THEMES[key] ?? THEMES.obsidian;
}

export function themeList(): DeckTheme[] {
  return THEME_IDS.map((id) => THEMES[id]);
}

/**
 * Pick the theme that suits a topic, when the user has not chosen one.
 *
 * Deliberately a small keyword vote rather than a model call: it runs while the
 * topic is still being typed, and a wrong guess costs one click in the picker.
 */
export function suggestTheme(topic: string): DeckTheme {
  const text = topic.toLowerCase();
  const votes: Record<ThemeId, number> = {
    obsidian: 0,
    ivory: 0,
    ember: 0,
    tide: 0,
    moss: 0,
    carbon: 0,
  };
  const add = (id: ThemeId, weight = 1) => {
    votes[id] += weight;
  };

  if (/\b(ai|model|engine|software|api|code|developer|infra|security|data|ml)\b/.test(text)) {
    add("obsidian", 2);
  }
  if (/\b(pitch|launch|fundrais|investor|brand|campaign|creative|music|film)\b/.test(text)) {
    add("ember", 2);
  }
  if (/\b(research|paper|thesis|history|literature|academic|study|report)\b/.test(text)) {
    add("ivory", 2);
  }
  if (/\b(climate|energy|nature|health|food|sustainab|agricultur|water)\b/.test(text)) {
    add("moss", 2);
  }
  if (/\b(product|platform|cloud|ocean|travel|design|ux|growth)\b/.test(text)) {
    add("tide", 2);
  }
  if (/\b(finance|consult|strategy|quarter|budget|operations|sales|legal)\b/.test(text)) {
    add("carbon", 2);
  }

  let best: ThemeId = "obsidian";
  for (const id of THEME_IDS) {
    if (votes[id] > votes[best]) best = id;
  }
  return THEMES[best];
}
