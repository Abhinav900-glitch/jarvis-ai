import { describe, expect, test } from "bun:test";
import {
  DIGEST_MAX_ITEMS,
  DIGEST_MAX_TURNS,
  DIGEST_TURN_CHARS,
  digestIsEmpty,
  digestPrompt,
  digestToMarkdown,
  digestTranscript,
  parseChatDigest,
} from "../chat-digest";

const turn = (role: string, content: string) => ({ role, content });

describe("digestTranscript", () => {
  test("labels the speakers and keeps the order", () => {
    const text = digestTranscript([turn("user", "hello"), turn("assistant", "hi")]);
    expect(text).toBe("User: hello\n\nAssistant: hi");
  });

  test("drops blank turns, which are usually attachments", () => {
    expect(digestTranscript([turn("user", "  "), turn("assistant", "ok")])).toBe(
      "Assistant: ok",
    );
  });

  test("keeps only the tail and says how much was left out", () => {
    const turns = Array.from({ length: DIGEST_MAX_TURNS + 5 }, (_, i) =>
      turn("user", `message ${i}`),
    );
    const text = digestTranscript(turns);
    expect(text).toContain("5 earlier messages omitted");
    expect(text).toContain(`message ${DIGEST_MAX_TURNS + 4}`);
    expect(text).not.toContain("message 0\n");
  });

  test("clips a single huge message", () => {
    const text = digestTranscript([turn("user", "y".repeat(DIGEST_TURN_CHARS + 100))]);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThan(DIGEST_TURN_CHARS + 40);
  });
});

describe("digestPrompt", () => {
  test("asks for the four sections and names the conversation", () => {
    const prompt = digestPrompt([turn("user", "pick a database")], "Architecture");
    expect(prompt).toContain("Architecture");
    expect(prompt).toContain("SUMMARY:");
    expect(prompt).toContain("DECIDED:");
    expect(prompt).toContain("OPEN:");
    expect(prompt).toContain("NEXT:");
  });

  test("says so when the conversation has no title", () => {
    expect(digestPrompt([turn("user", "x")])).toContain("(untitled)");
  });
});

describe("parseChatDigest", () => {
  test("reads every section", () => {
    const digest = parseChatDigest(
      [
        "SUMMARY: The user chose a database for the new service.",
        "DECIDED: Postgres, because the team already runs it",
        "OPEN: which migration tool to use",
        "NEXT: write the schema",
      ].join("\n"),
    );
    expect(digest.summary).toBe("The user chose a database for the new service.");
    expect(digest.decisions).toEqual(["Postgres, because the team already runs it"]);
    expect(digest.open).toEqual(["which migration tool to use"]);
    expect(digest.next).toEqual(["write the schema"]);
  });

  test("strips bullets and numbering that models add anyway", () => {
    const digest = parseChatDigest(
      ["DECIDED:", "- use Postgres", "2. ship on Friday"].join("\n"),
    );
    expect(digest.decisions).toEqual(["use Postgres", "ship on Friday"]);
  });

  test("accepts the tag spellings models use for the same section", () => {
    const digest = parseChatDigest(
      ["DECISION: one", "QUESTIONS: two", "TODO: three"].join("\n"),
    );
    expect(digest.decisions).toEqual(["one"]);
    expect(digest.open).toEqual(["two"]);
    expect(digest.next).toEqual(["three"]);
  });

  test("keeps summary prose running across lines", () => {
    const digest = parseChatDigest(
      ["SUMMARY: First sentence.", "Second sentence."].join("\n"),
    );
    expect(digest.summary).toBe("First sentence. Second sentence.");
  });

  test("caps each section", () => {
    const lines = [`DECIDED: one`, `DECIDED: two`, `DECIDED: three`, `DECIDED: four`];
    expect(parseChatDigest(lines.join("\n")).decisions).toHaveLength(
      DIGEST_MAX_ITEMS,
    );
  });

  test("treats an unrecognised colon line as prose, not as a section", () => {
    const digest = parseChatDigest(
      ["SUMMARY: short.", "Note: the user seems unsure."].join("\n"),
    );
    expect(digest.summary).toBe("short. Note: the user seems unsure.");
    expect(digest.open).toEqual([]);
  });

  test("falls back to the whole reply when nothing is tagged", () => {
    const digest = parseChatDigest("They settled on Postgres and moved on.");
    expect(digest.summary).toContain("Postgres");
    expect(digestIsEmpty(digest)).toBe(false);
  });

  test("an empty reply is an empty digest, not a crash", () => {
    expect(digestIsEmpty(parseChatDigest(""))).toBe(true);
  });
});

describe("digestToMarkdown", () => {
  test("writes headings, skips empty sections, and keeps the title", () => {
    const markdown = digestToMarkdown(
      { summary: "They picked Postgres.", decisions: ["Postgres"], open: [], next: ["Write the schema"] },
      "Architecture",
    );
    expect(markdown).toContain("# Recap — Architecture");
    expect(markdown).toContain("## Decided");
    expect(markdown).toContain("- Postgres");
    expect(markdown).toContain("## Next");
    expect(markdown).not.toContain("## Still open");
  });
});
