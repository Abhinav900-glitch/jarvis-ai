// ---------------------------------------------------------------------------
// Prompt templates — the slash commands that are a job, not a destination.
//
// Each entry is a specialised brief: the thing a good prompt adds over "please
// refactor this" is what to keep, what to output, and what to do when the input
// is missing. Keeping them in one table rather than inline in the send handler
// is what makes forty of them maintainable — the composer menu, the parser and
// the placeholder all read the same list.
//
// A template never mutates: `build(args)` returns the text that gets sent. That
// keeps them testable as strings, and means a command can be inspected by
// reading one line of the table.
// ---------------------------------------------------------------------------

import type { SlashGroup } from "./slash-commands";

export interface PromptTemplate {
  aliases: string[];
  group: SlashGroup;
  summary: string;
  argHint?: string;
  example: string;
  build: (args: string) => string;
}

/** The user's argument, or a pointer at the conversation when they gave none. */
const given = (args: string, fallback: string): string =>
  args.trim() || fallback;

const NO_CODE =
  "If no code was provided, work from the most recent code block in this conversation; if there is none, ask for it in one short question and stop.";

export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  // ---- Code -------------------------------------------------------------
  refactor: {
    aliases: ["cleanup"],
    group: "Code",
    summary: "Restructure code without changing behaviour",
    argHint: "<code>",
    example: "/refactor the parseConfig function",
    build: (args) =>
      [
        `Refactor this: ${given(args, "the code in your last message")}.`,
        "Behaviour must not change — no new features, no renamed public APIs, no dependency swaps.",
        "Return the complete refactored code in one fenced block, then a short bullet list of what changed and why, and state anything you deliberately left alone.",
        NO_CODE,
      ].join("\n"),
  },

  tests: {
    aliases: ["spec"],
    group: "Code",
    summary: "Write tests for code, covering edges and failures",
    argHint: "<code>",
    example: "/tests the formatCurrency helper",
    build: (args) =>
      [
        `Write tests for: ${given(args, "the code in your last message")}.`,
        "Match the test framework and style already visible in the conversation; if none is visible, ask which one.",
        "Cover the happy path, the boundaries (empty, zero, one, many, max), and the failure modes. Name each test after the behaviour it pins down, not the function it calls.",
        "Return runnable test code only, then a one-line note on what is still untested and why.",
        NO_CODE,
      ].join("\n"),
  },

  bugs: {
    aliases: ["bug"],
    group: "Code",
    summary: "Find real bugs, ranked by severity",
    argHint: "<code>",
    example: "/bugs the upload handler",
    build: (args) =>
      [
        `Find the bugs in: ${given(args, "the code in your last message")}.`,
        "Only report defects you can point at a line for — no speculation, no style notes.",
        "For each: the line, what goes wrong, the input or sequence that triggers it, and the smallest fix. Rank by severity, most damaging first. If you find none, say so plainly instead of inventing a concern.",
        NO_CODE,
      ].join("\n"),
  },

  security: {
    aliases: ["secaudit"],
    group: "Code",
    summary: "Security review: injection, authz, secrets, deps",
    argHint: "<code>",
    example: "/security the login route",
    build: (args) =>
      [
        `Security-review: ${given(args, "the code in your last message")}.`,
        "Check injection (SQL, shell, template, path), authentication and authorisation gaps, unsafe deserialisation, secret handling, obvious dependency risks, and missing input validation.",
        "For each finding: the vulnerable line, how it is exploited in one sentence, severity (high/medium/low), and the concrete fix. End with the one change that removes the most risk.",
        NO_CODE,
      ].join("\n"),
  },

  perf: {
    aliases: ["performance", "speed"],
    group: "Code",
    summary: "Performance review with the hot path named",
    argHint: "<code>",
    example: "/perf the search index build",
    build: (args) =>
      [
        `Review the performance of: ${given(args, "the code in your last message")}.`,
        "Identify the actual hot path, the cost that dominates it, and the complexity in big-O terms where it is knowable.",
        "Give fixes in order of payoff, each with an expected effect (nested loop to map lookup, N+1 query, repeated parse, unnecessary copy). Do not claim a measured speedup you cannot know — say what to measure instead.",
        NO_CODE,
      ].join("\n"),
  },

  doc: {
    aliases: ["docs", "document"],
    group: "Code",
    summary: "Docstrings and a README section for code",
    argHint: "<code>",
    example: "/doc the retry helper",
    build: (args) =>
      [
        `Document: ${given(args, "the code in your last message")}.`,
        "Write docstrings in the language's own convention (JSDoc, Python docstring, Go doc comment) covering purpose, parameters, return value, thrown errors, and one short usage example.",
        "Then a README section: what it is for, how to use it, and one caveat worth knowing. Describe only what the code does — do not invent options or behaviour.",
        NO_CODE,
      ].join("\n"),
  },

  types: {
    aliases: ["typing"],
    group: "Code",
    summary: "Add or tighten types without changing logic",
    argHint: "<code>",
    example: "/types the API response mapping",
    build: (args) =>
      [
        `Add proper types to: ${given(args, "the code in your last message")}.`,
        "Replace every implicit any with the narrowest accurate type, prefer unions over enums, and make illegal states unrepresentable where it is cheap to do so.",
        "Return the typed code in one fenced block, then list the assumptions you had to make about runtime data and what would need validating at the boundary.",
        NO_CODE,
      ].join("\n"),
  },

  sql: {
    aliases: ["query"],
    group: "Code",
    summary: "Turn a question into SQL, with the schema assumed",
    argHint: "<question, and schema if you have one>",
    example: "/sql top 10 customers by revenue last quarter, tables customers/orders",
    build: (args) =>
      [
        `Write the SQL for: ${given(args, "the request in your last message")}.`,
        "State the dialect you are targeting and the columns you assumed. Prefer explicit joins, name indexes that would matter, and avoid SELECT *.",
        "Return the query in one fenced block, then a line on how to read it, then the pitfalls (NULL handling, time zones, duplicate rows from joins). If the schema is ambiguous, ask one clarifying question instead of guessing silently.",
      ].join("\n"),
  },

  regex: {
    aliases: ["regexp"],
    group: "Code",
    summary: "Build a regex, explained and tested",
    argHint: "<what it should match>",
    example: "/regex match ISO dates but not timestamps",
    build: (args) =>
      [
        `Write a regular expression that matches: ${given(args, "the pattern in your last message")}.`,
        "Say which flavour it is for (JavaScript, PCRE, RE2) and flag anything that differs between them.",
        "Return the pattern in one fenced block, a line-by-line explanation of each part, and a table of strings it should match and should not. Prefer a readable pattern over the shortest one.",
      ].join("\n"),
  },

  script: {
    aliases: ["shell"],
    group: "Code",
    summary: "A safe shell script for a task",
    argHint: "<what the script should do>",
    example: "/script rotate backups older than 30 days",
    build: (args) =>
      [
        `Write a shell script that will: ${given(args, "the task in your last message")}.`,
        "Target POSIX sh unless bash is clearly needed, start with set -euo pipefail when using bash, quote every variable, and use mktemp for temporaries.",
        "Have it print what it will do and refuse destructive steps without an explicit flag. Return the script in one fenced block, then how to run it, then what it will not handle.",
      ].join("\n"),
  },

  commit: {
    aliases: ["commitmsg"],
    group: "Code",
    summary: "A commit message from a diff",
    argHint: "<diff or change summary>",
    example: "/commit add saved searches to the sidebar",
    build: (args) =>
      [
        `Write a commit message for: ${given(args, "the diff in your last message")}.`,
        "Subject line in the imperative mood, at most 72 characters, no trailing period. Then a blank line, then a body explaining why the change was made rather than restating the diff — wrapped at 72 columns.",
        "If the change is breaking, say so. Output the message as plain text, ready to paste, with nothing before or after it.",
      ].join("\n"),
  },

  pr: {
    aliases: ["pullrequest"],
    group: "Code",
    summary: "A pull request description with risks called out",
    argHint: "<what changed>",
    example: "/pr move billing to the new provider",
    build: (args) =>
      [
        `Write a pull request description for: ${given(args, "the diff in your last message")}.`,
        "Sections: what changed, why, how it was tested, risk and rollback. Keep the summary to three sentences.",
        "Call out anything a reviewer must look at closely, and any migration, config or deploy step that has to happen with the merge. Markdown, no filler like 'this PR does X' where X is already obvious.",
      ].join("\n"),
  },

  // ---- Writing ----------------------------------------------------------
  email: {
    aliases: ["mail"],
    group: "Write",
    summary: "Draft an email worth reading",
    argHint: "<what to say, and to whom>",
    example: "/email ask the vendor for a revised quote, firm but friendly",
    build: (args) =>
      [
        `Draft an email: ${given(args, "the message in your last message")}.`,
        "Subject line first, then the body. Lead with the ask in the first sentence, keep it under 150 words, and make the next step unmistakable.",
        "Match the tone the request implies and mirror the user's level of formality. No 'I hope this email finds you well'. Return only the email.",
      ].join("\n"),
  },

  reply: {
    aliases: ["respond"],
    group: "Write",
    summary: "Draft a reply to a message or thread",
    argHint: "<the message to answer>",
    example: "/reply decline the meeting politely, propose Thursday",
    build: (args) =>
      [
        `Draft a reply to: ${given(args, "the last message in this conversation")}.`,
        "Answer the points that need answering in the order they were raised, keep it shorter than the message it replies to, and state the outcome in one clear sentence.",
        "If the message asks something the user has not told you, mark that spot as [confirm: ...] rather than inventing a commitment.",
      ].join("\n"),
  },

  summarize: {
    aliases: ["summary"],
    group: "Write",
    summary: "TL;DR plus key points of text, a page or the last answer",
    argHint: "<text or URL>",
    example: "/summarize https://example.com/report",
    build: (args) =>
      [
        `Summarise: ${given(args, "the last long answer in this conversation")}.`,
        "Lead with a TL;DR of at most two sentences, then 3-6 key points, each one line and self-contained.",
        "Keep every number, date and name exactly as written. Do not add interpretation the source does not support, and say what the source leaves out if that matters.",
      ].join("\n"),
  },

  notes: {
    aliases: ["notetaking"],
    group: "Write",
    summary: "Turn messy text into structured notes",
    argHint: "<transcript or rough text>",
    example: "/notes the call transcript",
    build: (args) =>
      [
        `Turn this into structured notes: ${given(args, "the text in your last message")}.`,
        "Use headings, nested bullets, and bold for names, numbers and decisions. Group by topic rather than by the order things were said.",
        "Record what was decided, what is unresolved, and who owns what — but never add a fact that is not in the source. Mark unclear passages as [unclear].",
      ].join("\n"),
  },

  outline: {
    aliases: ["blueprint"],
    group: "Write",
    summary: "An outline for a piece before writing it",
    argHint: "<topic and audience>",
    example: "/outline a 1500-word post on why cron jobs drift",
    build: (args) =>
      [
        `Outline: ${given(args, "the piece described in your last message")}.`,
        "Give a title, the one-sentence argument the piece makes, then section headings with two bullets each covering what that section must prove.",
        "Order sections so each depends on the one before. Note the audience and the assumed knowledge level, and flag where a chart, example or quote would carry more than prose.",
      ].join("\n"),
  },

  draft: {
    aliases: ["write"],
    group: "Write",
    summary: "A first draft from a brief",
    argHint: "<brief: topic, audience, length>",
    example: "/draft 600 words on stopping notification fatigue, for engineers",
    build: (args) =>
      [
        `Write the draft: ${given(args, "the brief in your last message")}.`,
        "Concrete first sentence, no throat-clearing. One idea per paragraph, short sentences, active voice, and a specific example where an abstraction would be easy.",
        "Respect the requested length within about ten percent. End on the point, not on a summary of the points. Do not pad, and do not explain what you are about to do.",
      ].join("\n"),
  },

  rewrite: {
    aliases: ["retone"],
    group: "Write",
    summary: "Rewrite in a given voice and reading level",
    argHint: "<text | tone or reading level>",
    example: "/rewrite this error message in plain English",
    build: (args) =>
      [
        `Rewrite: ${given(args, "the text in your last message")}.`,
        "Preserve every fact, number and commitment; change only the voice, structure and reading level the request implies.",
        "Return the rewrite first, then one line naming what you changed. If the target tone would make a statement misleading, keep the meaning and say where you softened it.",
      ].join("\n"),
  },

  proofread: {
    aliases: ["grammar"],
    group: "Write",
    summary: "Fix spelling, grammar and consistency, change list included",
    argHint: "<text>",
    example: "/proofread the release notes",
    build: (args) =>
      [
        `Proofread: ${given(args, "the text in your last message")}.`,
        "Fix spelling, grammar, punctuation, and inconsistent capitalisation, hyphenation or terminology. Do not restyle the writing or shorten it.",
        "Return the corrected text, then a compact list of the changes made. For anything ambiguous, leave it and note the question instead of guessing.",
      ].join("\n"),
  },

  translate: {
    aliases: ["tr"],
    group: "Write",
    summary: "Translate text, keeping names and tone",
    argHint: "<language> <text>",
    example: "/translate German the onboarding email",
    build: (args) =>
      [
        `Translate: ${given(args, "the text in your last message")}.`,
        "The first token is the target language; if no language is given, translate into English and say so.",
        "Return only the translation, then one short note per idiom or term where a literal rendering would have been wrong. Keep names, product terms and numbers unchanged.",
      ].join("\n"),
  },

  // ---- Thinking ---------------------------------------------------------
  plan: {
    aliases: ["steps"],
    group: "Think",
    summary: "A step-by-step plan with dependencies and risks",
    argHint: "<the goal>",
    example: "/plan launch billing behind a feature flag",
    build: (args) =>
      [
        `Plan: ${given(args, "the goal in your last message")}.`,
        "Numbered steps in the order they must happen, each starting with a verb and small enough to finish in one sitting. Mark which steps can run in parallel and which block others.",
        "After the steps: the riskiest assumption, what would make the plan wrong, and the first check that would tell you early. No timeline unless a date was given.",
      ].join("\n"),
  },

  decide: {
    aliases: ["decision"],
    group: "Think",
    summary: "Compare options and recommend one",
    argHint: "<options and constraints>",
    example: "/decide Postgres vs SQLite for a single-server app",
    build: (args) =>
      [
        `Help decide: ${given(args, "the choice in your last message")}.`,
        "State the criteria that actually matter, then a comparison table of the options against them. Keep the table to the criteria that could change the answer.",
        "Give a recommendation, the condition under which the other option wins, and the cheapest test to reduce the uncertainty. Do not sit on the fence.",
      ].join("\n"),
  },

  critique: {
    aliases: ["redteam"],
    group: "Think",
    summary: "Attack a plan before reality does",
    argHint: "<plan or idea>",
    example: "/critique the offline-first sync design",
    build: (args) =>
      [
        `Critique: ${given(args, "the plan in your last message")}.`,
        "Find the weakest link, the hidden assumption, and the failure that would be most expensive to discover late. Say what breaks first and why.",
        "Then give the strongest version of the idea — the change that would make the critique moot. Be specific and blunt; skip praise and hedging.",
      ].join("\n"),
  },

  el5: {
    aliases: ["simple", "eli5"],
    group: "Think",
    summary: "Explain it so a curious beginner gets it",
    argHint: "<topic>",
    example: "/el5 database indexes",
    build: (args) =>
      [
        `Explain this like the reader is smart but new to the field: ${given(args, "the topic in your last message")}.`,
        "Start with the plainest true sentence, then one concrete analogy, then where the analogy breaks down. Use short paragraphs and no unexplained jargon.",
        "End with the one thing that usually confuses people at this level. Accuracy beats simplicity — never trade a correct detail for a tidy story.",
      ].join("\n"),
  },

  explain: {
    aliases: ["walkthrough"],
    group: "Think",
    summary: "Explain code or text line by line",
    argHint: "<code or passage>",
    example: "/explain the debounce hook",
    build: (args) =>
      [
        `Explain: ${given(args, "the code in your last message")}.`,
        "Walk through it in reading order: what each meaningful chunk does, why it is written that way, and what would break if it were removed.",
        "Then state the assumptions it makes about its inputs and one thing a reader could change to see the effect. Skip line-by-line commentary on imports and boilerplate.",
        NO_CODE,
      ].join("\n"),
  },

  hooks: {
    aliases: ["headlines", "titles"],
    group: "Write",
    summary: "Headlines and opening lines worth clicking",
    argHint: "<topic or draft>",
    example: "/hooks a post about deleting 40% of our code",
    build: (args) =>
      [
        `Write opening lines for: ${given(args, "the piece in your last message")}.`,
        "Give eight options across different angles: the surprising fact, the specific number, the contrarian claim, the plain-spoken promise. Keep each under 70 characters.",
        "Then mark the one you would publish and say why in a sentence. No clickbait that the piece cannot pay off.",
      ].join("\n"),
  },

  seo: {
    aliases: ["metadata"],
    group: "Write",
    summary: "Titles, meta descriptions and keyword gaps",
    argHint: "<topic or page>",
    example: "/seo a page about running Postgres on one server",
    build: (args) =>
      [
        `Write SEO metadata for: ${given(args, "the page in your last message")}.`,
        "Give three title options under 60 characters, three meta descriptions under 155, and a heading outline that matches how people search for this.",
        "Then name the queries the page would compete for and the ones it will not rank for without more content. Do not stuff keywords; write for a reader first.",
      ].join("\n"),
  },
};

/**
 * A command's prompt for the text the user typed, or null when the template
 * does not exist. Kept here so the send handler has one call, not a switch.
 */
export function buildPromptCommand(name: string, args: string): string | null {
  const template = PROMPT_TEMPLATES[name];
  return template ? template.build(args) : null;
}
