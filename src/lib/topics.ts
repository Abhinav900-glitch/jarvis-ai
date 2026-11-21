// ---------------------------------------------------------------------------
// Deck topic picker — the "what do you want to understand?" grid.
//
// The Deck Studio opens from a prompt, a slash command, or one of these tiles.
// The tiles are deliberately short and concrete: enough to start a build, not
// enough to pre-write the deck. Each one names a subject a student is likely to
// be studying, who it is for, and the one thing the opening slide should do.
// ---------------------------------------------------------------------------

export interface DeckTopic {
  /** Shown on the tile; this becomes the deck's working title if built as-is. */
  title: string;
  /** One line the presenter can say on the opening slide. */
  pitch: string;
  /** Who this is for, in a phrase. */
  audience: string;
}

/** Learnable topics that come back as a complete, explained .pptx. */
export const DECK_TOPICS: DeckTopic[] = [
  {
    title: "Photosynthesis",
    pitch: "Start from the equation, then show where each part comes from and why the plant needs it.",
    audience: "a first-time biology student",
  },
  {
    title: "Newton's three laws of motion",
    pitch: "One everyday example per law, worked through with the forces named.",
    audience: "a physics student meeting forces for the first time",
  },
  {
    title: "Fractions, decimals and percentages",
    pitch: "Show each as the same quantity in three notations, with one worked conversion.",
    audience: "a student who can add but mixes the notations",
  },
  {
    title: "The water cycle",
    pitch: "Follow one drop through every stage, naming the process at each step.",
    audience: "a geography student learning the vocabulary",
  },
  {
    title: "How vaccines work",
    pitch: "Explain the immune response first, then what the vaccine trains and why timing matters.",
    audience: "a student asking a health question, not a clinician",
  },
  {
    title: "Supply and demand",
    pitch: "Draw the two curves, then change one thing at a time and explain the new price.",
    audience: "an economics student meeting the model for the first time",
  },
  {
    title: "The causes of the French Revolution",
    pitch: "Separate long-term pressures from the spark, and show how they reinforced each other.",
    audience: "a history student preparing an essay",
  },
  {
    title: "Binary numbers",
    pitch: "Count in binary before converting anything; the place values do the explaining.",
    audience: "a computing student who has only used decimal",
  },
  {
    title: "The carbon cycle",
    pitch: "Name every reservoir and the process that moves carbon between them.",
    audience: "a student linking biology and climate",
  },
  {
    title: "Macbeth: ambition and guilt",
    pitch: "Anchor each theme in one quotation, then show what the language actually does.",
    audience: "a literature student revising for an exam",
  },
];
