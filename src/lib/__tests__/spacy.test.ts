// A spaCy wrapper is operator-written, so the parser has to survive both the
// natural FastAPI shape (`pos_`, `tag_`, `ents`) and the tidy one.

import { describe, expect, test } from "bun:test";
import { parseSpacyAnalysis, spacyEndpoint } from "../spacy";

describe("spacyEndpoint", () => {
  test("the configured path is kept as-is", () => {
    expect(spacyEndpoint("https://nlp.internal:8000/analyze")).toBe(
      "https://nlp.internal:8000/analyze",
    );
    expect(spacyEndpoint("https://nlp.internal:8000/")).toBe(
      "https://nlp.internal:8000",
    );
    expect(spacyEndpoint("  https://nlp.internal/nlp  ")).toBe(
      "https://nlp.internal/nlp",
    );
  });

  test("unconfigured stays empty", () => {
    expect(spacyEndpoint(undefined)).toBe("");
  });
});

describe("parseSpacyAnalysis", () => {
  const documented = {
    lang: "en",
    sentences: ["John works at Google.", "Paris is in France."],
    tokens: [
      { text: "John", pos: "PROPN", tag: "NNP", lemma: "John" },
      { text: "works", pos: "VERB", tag: "VBZ", lemma: "work" },
      { text: "at", pos: "ADP", tag: "IN", lemma: "at" },
      { text: "Google", pos: "PROPN", tag: "NNP", lemma: "Google" },
    ],
    entities: [{ text: "Google", label: "ORG", start: 15, end: 21 }],
  };

  test("the documented shape is summarised", () => {
    const out = parseSpacyAnalysis(documented);
    expect(out.lang).toBe("en");
    expect(out.syntax.sentences).toBe(2);
    expect(out.syntax.tokens).toBe(4);
    expect(out.syntax.pos[0]).toEqual({ tag: "PROPN", count: 2 });
    expect(out.entities).toEqual([{ text: "Google", label: "org" }]);
  });

  test("underscored spaCy attribute names are accepted", () => {
    const out = parseSpacyAnalysis({
      tokens: [{ word: "x", pos_: "NOUN", tag_: "NN" }],
      ents: [{ text_: "India", label_: "GPE" }],
      language: "hi",
    });
    expect(out.syntax.pos[0]).toEqual({ tag: "NOUN", count: 1 });
    expect(out.entities[0]).toEqual({ text: "India", label: "gpe" });
    expect(out.lang).toBe("hi");
  });

  test("counts are accepted in place of lists", () => {
    const out = parseSpacyAnalysis({ sentence_count: 7, token_count: 120 });
    expect(out.syntax.sentences).toBe(7);
    expect(out.syntax.tokens).toBe(120);
    expect(out.syntax.pos).toEqual([]);
  });

  test("an empty or hostile body yields empty syntax rather than throwing", () => {
    expect(parseSpacyAnalysis(null)).toEqual({
      lang: null,
      syntax: { sentences: null, tokens: null, pos: [] },
      entities: [],
    });
    expect(parseSpacyAnalysis("nope").syntax.tokens).toBeNull();
    expect(parseSpacyAnalysis({ entities: [{ label: "person" }] }).entities).toEqual(
      [],
    );
  });
});
