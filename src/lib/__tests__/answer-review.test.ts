import { describe, expect, test } from "bun:test";
import {
  answerReviewPrompt,
  parseAnswerReview,
  REVIEW_ANSWER_LIMIT,
  REVIEW_MAX_ISSUES,
} from "../answer-review";

describe("answerReviewPrompt", () => {
  test("carries both the question and the answer", () => {
    const prompt = answerReviewPrompt("Why is the sky blue?", "Rayleigh scattering.");
    expect(prompt).toContain("Why is the sky blue?");
    expect(prompt).toContain("Rayleigh scattering.");
  });

  test("states the reply format it expects", () => {
    const prompt = answerReviewPrompt("q", "a");
    expect(prompt).toContain("VERDICT: solid | mixed | wrong");
    expect(prompt).toContain("CONFIDENCE:");
  });

  test("trims a long answer and marks the cut", () => {
    const prompt = answerReviewPrompt("q", "x".repeat(REVIEW_ANSWER_LIMIT + 500));
    expect(prompt).toContain("omitted for length");
    expect(prompt.length).toBeLessThan(REVIEW_ANSWER_LIMIT + 2_000);
  });

  test("does not leave an empty question section", () => {
    expect(answerReviewPrompt("", "some answer")).toContain("not recorded");
  });
});

describe("parseAnswerReview", () => {
  test("reads a well-formed review", () => {
    const review = parseAnswerReview(
      [
        "VERDICT: mixed",
        "CONFIDENCE: 0.7",
        "ISSUE: the library was renamed in 2024 | the current name is different",
        "FIX: use the new package name",
      ].join("\n"),
    );
    expect(review.verdict).toBe("mixed");
    expect(review.confidence).toBe(0.7);
    expect(review.issues).toEqual([
      {
        claim: "the library was renamed in 2024",
        problem: "the current name is different",
      },
    ]);
    expect(review.fix).toBe("use the new package name");
  });

  test("survives markdown emphasis around the tags", () => {
    const review = parseAnswerReview("**VERDICT:** solid\n**CONFIDENCE:** 90%");
    expect(review.verdict).toBe("solid");
    expect(review.confidence).toBe(0.9);
  });

  test("folds the spellings models actually use onto three verdicts", () => {
    expect(parseAnswerReview("VERDICT: incorrect").verdict).toBe("wrong");
    expect(parseAnswerReview("VERDICT: mostly-correct").verdict).toBe("solid");
    expect(parseAnswerReview("VERDICT: unreliable").verdict).toBe("mixed");
  });

  test("falls back to unclear without throwing when the format is ignored", () => {
    const review = parseAnswerReview("This answer looks fine to me.");
    expect(review.verdict).toBe("unclear");
    expect(review.confidence).toBeNull();
    expect(review.issues).toEqual([]);
    expect(review.summary).toContain("looks fine");
  });

  test("accepts confidence as a ratio and clamps it into range", () => {
    expect(parseAnswerReview("VERDICT: mixed\nCONFIDENCE: 8/10").confidence).toBe(0.8);
    expect(parseAnswerReview("VERDICT: mixed\nCONFIDENCE: 140%").confidence).toBe(1);
  });

  test("keeps a bare issue line as the problem with no claim", () => {
    const review = parseAnswerReview("VERDICT: mixed\nISSUE: nothing here is cited");
    expect(review.issues).toEqual([
      { claim: null, problem: "nothing here is cited" },
    ]);
  });

  test("caps the issue list", () => {
    const lines = ["VERDICT: wrong"];
    for (let i = 0; i < 6; i += 1) lines.push(`ISSUE: claim ${i} | wrong ${i}`);
    expect(parseAnswerReview(lines.join("\n")).issues).toHaveLength(
      REVIEW_MAX_ISSUES,
    );
  });

  test("drops a fix on a solid verdict, where it would contradict the badge", () => {
    expect(parseAnswerReview("VERDICT: solid\nFIX: none").fix).toBeNull();
  });

  test("keeps the prose around the tags as the summary", () => {
    const review = parseAnswerReview(
      "Solid overall.\nVERDICT: solid\nCONFIDENCE: 0.9\nNothing to correct.",
    );
    expect(review.verdict).toBe("solid");
    expect(review.summary).toBe("Solid overall. Nothing to correct.");
  });
});
