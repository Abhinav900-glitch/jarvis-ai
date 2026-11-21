// ---------------------------------------------------------------------------
// Deck topic picker.
//
// The Deck Studio opens from a prompt, a slash command, or one of these tiles.
// The tiles are deliberately short and concrete: enough to start a build, not
// enough to pre-write the deck. A tile's job is to name the ask plainly, hint
// at the listener, and give the writer a direction for the first slide.
// ---------------------------------------------------------------------------

export interface DeckTopic {
  /** Shown on the tile; this becomes the deck's working title if built as-is. */
  title: string;
  /** One line the presenter can say on the opening slide. */
  pitch: string;
  /** Who this is for, in a phrase. */
  audience: string;
}

/** Common deck topics that tend to come back as finished .pptx files. */
export const DECK_TOPICS: DeckTopic[] = [
  {
    title: "What changed this quarter",
    pitch:
      "Open by naming the one number the room should remember before anything else.",
    audience: "an informed internal audience",
  },
  {
    title: "A product, in plain language",
    pitch:
      "Lead with the problem the product solves, not the feature list.",
    audience: "someone new to the product",
  },
  {
    title: "How this works, step by step",
    pitch:
      "Each slide should answer one next question, not carry the whole explainer.",
    audience: "a learner with the basics, not an expert",
  },
  {
    title: "Two options, honestly compared",
    pitch:
      "Compare like with like; a table is only honest if every row means the same thing.",
    audience: "someone deciding between A and B",
  },
  {
    title: "The lesson behind a mistake",
    pitch:
      "State the mistake plainly, then spend the deck on the fix, not the blame.",
    audience: "a team that needs to avoid repeating it",
  },
  {
    title: "Why this matters now",
    pitch:
      "Anchor the urgency in something concrete before the arguments.",
    audience: "a room that needs a reason to pay attention",
  },
  {
    title: "From idea to rollout",
    pitch:
      "Name the phases, the decision at each one, and what 'done' looks like.",
    audience: "a project team or manager",
  },
  {
    title: "A concept, from example to rule",
    pitch:
      "Start from one concrete case, then show the rule it implies.",
    audience: "someone learning the idea for the first time",
  },
  {
    title: "What the data actually says",
    pitch:
      "Let the numbers drive the story; mark any figure that is illustrative.",
    audience: "a data-curious reader, not a statistician",
  },
  {
    title: "What to do next, concretely",
    pitch:
      "End on a small next step someone can own this week, not a wish list.",
    audience: "a team ready to act",
  },
];
