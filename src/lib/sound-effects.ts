// ---------------------------------------------------------------------------
// Sound effects — the one thing a text model can never do.
//
// Every LLM answers "what does a dog say?" in *words*. Jarvis can actually
// bark. Each cue maps a set of everyday phrasings to a generation prompt, and
// `matchSoundCue` decides when a message is really a request for a sound
// rather than a normal question that happens to contain the same word.
//
// Matching is deliberately conservative: short messages only, word-boundary
// matches only (so "moo" can't fire inside "moon" or "room"), and cues whose
// keywords double as common English words — rain, buzz, clock, applause —
// require an explicit "make/play/…" request before they trigger.
// ---------------------------------------------------------------------------

export interface SoundCue {
  /** Stable id, also used as the React key and the cache salt. */
  id: string;
  /** Human label shown in the UI and in the transcript. */
  label: string;
  /** Emoji shown next to the label. */
  emoji: string;
  /** Keywords that trigger this cue, matched on word boundaries. */
  keywords: string[];
  /**
   * The generation prompt. Written the way a sound designer would describe a
   * foley take — concrete, close-mic, no music — because that is what produces
   * a usable clip rather than a cinematic sting.
   */
  prompt: string;
  /** Target length in seconds (ElevenLabs allows 0.5–30). */
  duration?: number;
  /**
   * Cues whose keywords are ordinary words need an explicit request verb in
   * the message, otherwise "it's raining in Paris" would moo at you.
   */
  needsExplicitRequest?: boolean;
}

export const SOUND_CUES: SoundCue[] = [
  // --- Animals ---------------------------------------------------------------
  {
    id: "dog-bark",
    label: "Dog barking",
    emoji: "🐕",
    keywords: ["bark", "barking", "woof", "dog sound", "dog noise"],
    prompt:
      "A medium-sized domestic dog barking sharply twice outdoors, close-mic foley recording, natural throat resonance, no music, no voice",
  },
  {
    id: "dog-growl",
    label: "Dog growling",
    emoji: "🐺",
    keywords: ["growl", "growling", "snarl"],
    prompt:
      "A dog growling low and menacing in a quiet room, close-mic foley, subtle breath, no music",
  },
  {
    id: "dog-whine",
    label: "Dog whining",
    emoji: "🥺",
    keywords: ["whine", "whining", "puppy"],
    prompt:
      "A small puppy whining softly and hopefully, close-mic foley recording, no music",
  },
  {
    id: "cat-meow",
    label: "Cat meowing",
    emoji: "🐈",
    keywords: ["meow", "meowing", "cat sound", "cat noise", "miao"],
    prompt:
      "A domestic cat meowing once, close-mic foley recording, soft breathy voice, no music",
  },
  {
    id: "cat-purr",
    label: "Cat purring",
    emoji: "😺",
    keywords: ["purr", "purring", "purrs"],
    prompt:
      "A cat purring contentedly, close-mic foley recording, gentle rumble, no music",
    duration: 4,
  },
  {
    id: "cat-hiss",
    label: "Cat hissing",
    emoji: "🙇",
    keywords: ["hiss", "hissing", "hissy"],
    prompt:
      "A cat hissing and spitting defensively, close-mic foley recording, no music",
  },
  {
    id: "lion-roar",
    label: "Lion roaring",
    emoji: "🦁",
    keywords: ["lion", "roar", "roaring"],
    needsExplicitRequest: true,
    prompt:
      "A male lion roaring in the savannah, distant naturalistic wildlife recording, no music",
  },
  {
    id: "wolf-howl",
    label: "Wolf howling",
    emoji: "🐺",
    keywords: ["howl", "howling", "wolf"],
    needsExplicitRequest: true,
    prompt:
      "A wolf howling alone on a cold night, distant naturalistic recording, no music",
  },
  {
    id: "horse-neigh",
    label: "Horse neighing",
    emoji: "🐴",
    keywords: ["neigh", "neighing", "whinny", "whinnying"],
    prompt:
      "A horse whinnying and snorting in a stable, close-mic foley, no music",
  },
  {
    id: "cow-moo",
    label: "Cow mooing",
    emoji: "🐄",
    keywords: ["moo", "mooing", "cattle"],
    prompt:
      "A cow mooing low and long in an open pasture, naturalistic field recording, no music",
  },
  {
    id: "pig-oink",
    label: "Pig oinking",
    emoji: "🐖",
    keywords: ["oink", "oinking", "pig sound"],
    prompt:
      "A pig oinking and snorting in a pen, close-mic foley recording, no music",
  },
  {
    id: "sheep-baa",
    label: "Sheep baa-ing",
    emoji: "🐑",
    keywords: ["baa", "baaing", "bleat", "bleating", "sheep sound"],
    prompt:
      "A sheep bleating in a field, naturalistic recording, no music",
  },
  {
    id: "duck-quack",
    label: "Duck quacking",
    emoji: "🦆",
    keywords: ["quack", "quacking", "duck sound"],
    prompt:
      "A domestic duck quacking loudly by a pond, close-mic naturalistic recording, no music",
  },
  {
    id: "rooster-crow",
    label: "Rooster crowing",
    emoji: "🐓",
    keywords: ["rooster", "cockcrow", "crowing"],
    prompt:
      "A rooster crowing at dawn in a farmyard, naturalistic recording, no music",
  },
  {
    id: "owl-hoot",
    label: "Owl hooting",
    emoji: "🦉",
    keywords: ["hoot", "hooting", "owl sound"],
    prompt:
      "An owl hooting twice in a quiet night forest, naturalistic recording, no music",
  },
  {
    id: "frog-croak",
    label: "Frog croaking",
    emoji: "🐸",
    keywords: ["croak", "croaking", "frog sound"],
    prompt:
      "Frogs croaking in a swamp at dusk, naturalistic ambience recording, no music",
  },
  {
    id: "bee-buzz",
    label: "Bee buzzing",
    emoji: "🐝",
    keywords: ["buzz", "buzzing", "bee sound", "bees"],
    prompt:
      "A close-up of a honeybee buzzing and flying near a flower, naturalistic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "bird-chirp",
    label: "Birds chirping",
    emoji: "🐦",
    keywords: ["chirp", "chirping", "tweet", "tweeting", "bird sound", "birdsong"],
    prompt:
      "Small songbirds chirping in a spring garden, close naturalistic recording, no music",
  },
  {
    id: "whale-song",
    label: "Whale song",
    emoji: "🐋",
    keywords: ["whale", "whale song"],
    prompt:
      "A humpback whale singing underwater, hydrophone recording, no music",
  },
  {
    id: "monkey-screech",
    label: "Monkey screeching",
    emoji: "🐒",
    keywords: ["monkey", "screech", "screeching", "chatter"],
    needsExplicitRequest: true,
    prompt:
      "A troop of monkeys screeching and chattering in a jungle, naturalistic recording, no music",
  },
  {
    id: "snake-hiss",
    label: "Snake hissing",
    emoji: "🐍",
    keywords: ["snake", "rattlesnake", "rattle"],
    needsExplicitRequest: true,
    prompt:
      "A rattlesnake rattling and hissing in dry grass, close-mic foley, no music",
  },
  {
    id: "mouse-squeak",
    label: "Mouse squeaking",
    emoji: "🐭",
    keywords: ["mouse", "squeak", "squeaking", "rat sound"],
    needsExplicitRequest: true,
    prompt:
      "A small mouse squeaking and rustling, close-mic foley recording, no music",
  },

  // --- Human -----------------------------------------------------------------
  {
    id: "laugh",
    label: "Laughter",
    emoji: "😂",
    keywords: ["laugh", "laughter", "laughing", "giggle", "chuckle"],
    prompt: "A person laughing naturally and warmly, close-mic, no music",
  },
  {
    id: "sneeze",
    label: "Sneeze",
    emoji: "🤧",
    keywords: ["sneeze", "sneezing", "achoo"],
    prompt: "A person sneezing twice, close-mic foley, no music",
  },
  {
    id: "cough",
    label: "Cough",
    emoji: "😷",
    keywords: ["cough", "coughing"],
    prompt: "A person coughing, close-mic foley recording, no music",
  },
  {
    id: "clap",
    label: "Applause",
    emoji: "👏",
    keywords: ["applause", "clapping", "clap", "bravo", "cheer"],
    prompt: "A crowd applauding and cheering, naturalistic audience recording, no music",
    needsExplicitRequest: true,
  },
  {
    id: "baby-cry",
    label: "Baby crying",
    emoji: "👶",
    keywords: ["baby cry", "baby crying", "infant cry"],
    prompt: "A small baby crying softly, close-mic foley recording, no music",
  },
  {
    id: "snore",
    label: "Snoring",
    emoji: "😴",
    keywords: ["snore", "snoring", "snores"],
    prompt: "A person snoring steadily, close-mic foley recording, no music",
    needsExplicitRequest: true,
  },

  // --- Ambience & objects ----------------------------------------------------
  {
    id: "thunder",
    label: "Thunder",
    emoji: "⛈️",
    keywords: ["thunder", "thunderstorm", "thunderclap"],
    prompt: "A rolling thunderclap over an open plain, wide natural recording, no music",
    needsExplicitRequest: true,
  },
  {
    id: "rain",
    label: "Rain",
    emoji: "🌧️",
    keywords: ["rain", "raining", "rainfall", "drizzle"],
    prompt: "Steady rain falling on a window and pavement, naturalistic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "ocean",
    label: "Ocean waves",
    emoji: "🌊",
    keywords: ["ocean", "waves", "wave", "seaside", "surf"],
    prompt: "Gentle ocean waves breaking on a sandy beach, naturalistic recording, no music",
    needsExplicitRequest: true,
  },
  {
    id: "fire",
    label: "Crackling fire",
    emoji: "🔥",
    keywords: ["fire", "crackle", "crackling", "campfire", "fireplace"],
    prompt: "A campfire crackling in a quiet forest, close-mic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "wind",
    label: "Windy",
    emoji: "💨",
    keywords: ["wind", "windy", "gusting wind", "breeze"],
    prompt: "Strong wind gusting through bare trees, naturalistic field recording, no music",
    needsExplicitRequest: true,
  },
  {
    id: "doorbell",
    label: "Doorbell",
    emoji: "🔔",
    keywords: ["doorbell", "door bell", "buzzer"],
    prompt: "A household doorbell chiming twice, close-mic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "phone-ring",
    label: "Telephone ring",
    emoji: "📞",
    keywords: ["phone ring", "telephone ring", "phone ringing"],
    prompt: "An old telephone ringing in a quiet hallway, close-mic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "alarm-beep",
    label: "Alarm beeping",
    emoji: "⏰",
    keywords: ["alarm", "beep", "beeping", "buzzer beep"],
    prompt: "A harsh electronic alarm beeping repeatedly, close-mic, no music",
    needsExplicitRequest: true,
  },
  {
    id: "clock-tick",
    label: "Clock ticking",
    emoji: "🕰️",
    keywords: ["clock", "ticking", "tick tock"],
    prompt: "A mechanical wall clock ticking steadily in a quiet room, close-mic, no music",
    needsExplicitRequest: true,
  },
  {
    id: "camera-shutter",
    label: "Camera shutter",
    emoji: "📷",
    keywords: ["camera", "shutter", "photo click"],
    prompt: "A DSLR camera shutter firing once, close-mic foley, no music",
    needsExplicitRequest: true,
  },
  {
    id: "car-horn",
    label: "Car horn",
    emoji: "📢",
    keywords: ["car horn", "horn honk", "honk", "honking"],
    prompt: "A car horn honking twice on a city street, naturalistic recording, no music",
  },
  {
    id: "sword-clash",
    label: "Sword clash",
    emoji: "⚔️",
    keywords: ["sword", "clash", "sword fight", "metal clash"],
    prompt: "Two steel swords clashing in a fight, close-mic foley, no music",
  },
  {
    id: "laser",
    label: "Laser zap",
    emoji: "⚡",
    keywords: ["laser", "zap", "pew", "laser shot"],
    prompt: "A science-fiction laser firing and zapping, clean synthetic sound effect",
  },
  {
    id: "drum-roll",
    label: "Drum roll",
    emoji: "🥁",
    keywords: ["drum roll", "drumroll", "drums", "timpani"],
    prompt: "A dramatic timpani drum roll building to a crash, cinematic, no melody",
  },
  {
    id: "gong",
    label: "Gong",
    emoji: "🥁",
    keywords: ["gong", "tam-tam"],
    prompt: "A large bronze gong struck once and slowly fading, close-mic, no music",
  },
];

/** Words that mean "I am asking for a sound", not "I am mentioning one". */
const REQUEST_VERBS =
  /\b(play|make|give|produce|create|do a|hear|sound|sounds|sounding|imitate|emulate|mimic|can you|could you|would you|let me hear|then|next|afterwards|after that|followed by|first|also)\b/i;

/**
 * Verbs that mean the user is asking a *question about* the sound, not for the
 * sound. Without this, "summarise the article about barking dogs" would bark.
 */
const NON_REQUEST_VERBS =
  /\b(summari[sz]e|write|explain|translate|define|describe|compare|difference|article|story|essay|history|book|meaning|spell|pronounce|who|when|where|why|how many|search|cite|references?|list|give me a list)\b/i;

/**
 * Nouns that mark a request for a sound rather than a mention of an animal.
 * "make"/"makes" is deliberately absent — it is a request verb, but it also
 * appears in "make a dog house", which is not a request for a bark. The
 * "what does a cow make" phrasing is handled by its own question rule below.
 */
const SOUND_NOUNS =
  /\b(sound|sounds|noise|noises|cry|cries|call|calls|voice|say|says|imitate|imitates|mimic)\b/i;

/**
 * Sequencing words. A bare list of animals only means "play me those" when it
 * is chained — "dog then cat" is a request, "make a dog house" is not.
 */
const CHAIN_WORDS =
  /\b(then|next|afterwards|after that|followed by|first of all|and then)\b/i;

/** Filler words that carry no intent of their own. */
const FILLER_WORDS = new Set([
  "please", "can", "could", "would", "you", "i", "want", "to", "hear", "play",
  "make", "give", "produce", "create", "do", "a", "an", "the", "me", "now",
  "like", "sound", "sounds", "of", "for", "some", "that", "get", "me",
]);

/** Above this length a message is treated as prose, not a sound request. */
const MAX_INTENT_CHARS = 160;

/** Longest chain of sounds we will play back in one message. */
const MAX_CHAIN = 5;

/** "what does a dog say" → the dog cue, without listing every phrasing. */
const ANIMAL_BY_NAME: Record<string, string> = {
  dog: "dog-bark",
  puppy: "dog-whine",
  cat: "cat-meow",
  kitten: "cat-meow",
  lion: "lion-roar",
  tiger: "lion-roar",
  wolf: "wolf-howl",
  horse: "horse-neigh",
  cow: "cow-moo",
  cattle: "cow-moo",
  pig: "pig-oink",
  sheep: "sheep-baa",
  lamb: "sheep-baa",
  goat: "sheep-baa",
  duck: "duck-quack",
  goose: "duck-quack",
  rooster: "rooster-crow",
  owl: "owl-hoot",
  frog: "frog-croak",
  bee: "bee-buzz",
  bird: "bird-chirp",
  whale: "whale-song",
  monkey: "monkey-screech",
  snake: "snake-hiss",
  mouse: "mouse-squeak",
  rat: "mouse-squeak",
  cricket: "bird-chirp",
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Strip punctuation and filler, leaving the content words of a request. */
function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => !FILLER_WORDS.has(token),
  );
}

/**
 * "lion roar", "thunder", "doorbell" — the message is nothing but the name of
 * the sound. That is unambiguously a request, and it is the common way people
 * ask once they see the sound picker.
 */
function isBareSoundRequest(text: string, cue: SoundCue): boolean {
  const tokens = contentTokens(text);
  if (tokens.length === 0) return true; // "play", "make a sound"
  if (tokens.length > 3) return false;
  const known = new Set([...cue.keywords, cue.label.toLowerCase()]);
  return tokens.every((token) => known.has(token));
}

/**
 * Find the sound cue a message is asking for, or null when it is an ordinary
 * question. Exported for the composer chips and the live voice loop.
 */
/**
 * Every cue a message asks for, in the order they were asked for.
 *
 * A single request is the common case and returns a one-item array. A chain —
 * "dog then cat then lion" — returns all three, ordered by where each name
 * appears in the sentence, so the sounds play back the way they were asked.
 */
export function findSoundCues(input: string): SoundCue[] {
  const text = input?.trim() ?? "";
  if (!text || text.length > MAX_INTENT_CHARS) return [];
  // Asking *about* sounds is not asking for them.
  if (NON_REQUEST_VERBS.test(text)) return [];

  const byId = new Map(SOUND_CUES.map((cue) => [cue.id, cue]));
  const wordCount = (text.match(/[\p{L}\p{N}']+/gu) ?? []).length;
  const explicit = REQUEST_VERBS.test(text);
  // Some intent has to be present, or "the dog barked up the wrong tree" plays.
  if (!explicit && wordCount > 6) return [];

  // cue id -> earliest position it was mentioned at
  const hits = new Map<string, number>();
  const record = (cue: SoundCue | undefined, index: number) => {
    if (!cue || index < 0) return;
    const current = hits.get(cue.id);
    if (current === undefined || index < current) hits.set(cue.id, index);
  };

  // 1. Literal keywords, longest first so "dog sound" beats a bare "dog".
  const ranked = SOUND_CUES.flatMap((cue) =>
    cue.keywords.map((keyword) => ({ cue, keyword })),
  ).sort((a, b) => b.keyword.length - a.keyword.length);
  for (const { cue, keyword } of ranked) {
    const pattern = new RegExp(`(?:^|\\b)${escapeRegExp(keyword)}(?:\\b|$)`, "i");
    const index = text.search(pattern);
    if (index >= 0) record(cue, index);
  }

  // 2. An animal name beside a word about sound, in any order — "the sound of
  //    a dog", "a dog sounds", "a cow sound", "sound like a horse". A chain
  //    ("dog then cat") counts too, since a chained bare list of animals is
  //    unmistakably a list of sounds.
  if (SOUND_NOUNS.test(text) || CHAIN_WORDS.test(text)) {
    for (const [name, cueId] of Object.entries(ANIMAL_BY_NAME)) {
      const index = text.search(new RegExp(`\\b${name}(?:s|'s)?\\b`, "i"));
      record(byId.get(cueId), index);
    }
  }

  // 3. "what does a dog say" — the animal is the subject, the verb is a sound.
  for (const [name, cueId] of Object.entries(ANIMAL_BY_NAME)) {
    const pattern = new RegExp(
      `\\b(?:what|which)\\b[^.?!]*?\\b(?:does|do|is|are)\\b[^.?!]*?\\b${name}\\b[^.?!]*?\\b(?:say|says|make|makes|sound|sounds|noise|noises)\\b`,
      "i",
    );
    const index = text.search(pattern);
    record(byId.get(cueId), index);
  }

  // Drop cues whose own strictness rules aren't satisfied, then play in the
  // order the user asked for them.
  return [...hits.entries()]
    .filter(([cueId]) => {
      const cue = byId.get(cueId);
      if (!cue) return false;
      if (cue.needsExplicitRequest && !explicit && !isBareSoundRequest(text, cue)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAX_CHAIN)
    .map(([cueId]) => byId.get(cueId)!)
    .filter(Boolean);
}

/** The single best cue, or null. Use {@link findSoundCues} for chains. */
export function matchSoundCue(input: string): SoundCue | null {
  return findSoundCues(input)[0] ?? null;
}

/**
 * True when the message is *only* a sound request ("bark", "do a cat meow"),
 * as opposed to a question that merely contains the keyword — the difference
 * between playing the sound and playing it *and* answering.
 */
export function isSoundOnlyRequest(input: string): boolean {
  const text = input?.trim() ?? "";
  if (!text) return false;
  // "what does a dog say" is answered with the bark alone; "explain how a dog
  // barks to a child" is a real question and still needs prose.
  return contentTokens(text).length <= 2;
}

/**
 * The written line that accompanies a sound: "🐕 Dog barking" for one cue, or
 * a chain like "🐕 Dog barking → 🐈 Cat meowing → 🦁 Lion roaring".
 */
export function cueLine(cues: SoundCue[], markdown = false): string {
  const joined = cues.map((cue) => `${cue.emoji}  ${cue.label}`).join("  →  ");
  return markdown ? `*${joined}*` : joined;
}
