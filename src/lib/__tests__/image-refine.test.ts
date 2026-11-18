import { describe, expect, test } from "bun:test";
import { judgePrompt, parseImageJudgement } from "../image-refine";

describe("judgePrompt", () => {
  test("states the brief, the numbering and asks for JSON", () => {
    const prompt = judgePrompt("a fox in morning fog", 3);
    expect(prompt).toContain("The picture asked for: a fox in morning fog");
    expect(prompt).toContain("1 to 3");
    expect(prompt).toContain('{"scores"');
    expect(prompt).not.toContain('"refine"');
  });

  test("asks for a rewritten prompt only when refining", () => {
    expect(judgePrompt("a fox", 1, { refine: true })).toContain('"refine"');
  });

  test("a missing brief does not print undefined", () => {
    const prompt = judgePrompt("   ", 1);
    expect(prompt).toContain("(no description given)");
    expect(prompt).not.toContain("undefined");
  });
});

describe("parseImageJudgement", () => {
  test("reads scores, verdicts and the one-based best index", () => {
    const text = JSON.stringify({
      scores: [
        { image: 1, score: 74, verdict: "Fox is off-centre." },
        { image: 2, score: 88, verdict: "Clear subject, good light." },
      ],
      best: 2,
    });
    expect(parseImageJudgement(text, 2)).toEqual({
      entries: [
        { score: 74, verdict: "Fox is off-centre." },
        { score: 88, verdict: "Clear subject, good light." },
      ],
      best: 1,
      refine: null,
    });
  });

  test("fenced JSON is unwrapped", () => {
    const text = '```json\n{"scores":[{"score":91}],"best":1}\n```';
    expect(parseImageJudgement(text, 1)?.entries[0].score).toBe(91);
  });

  test("a bare list is read in the order the images were shown", () => {
    const parsed = parseImageJudgement('{"scores": [61, 82]}', 2);
    expect(parsed?.entries.map((entry) => entry.score)).toEqual([61, 82]);
    expect(parsed?.best).toBe(1);
  });

  test("percentages and slash forms are numbers", () => {
    const parsed = parseImageJudgement(
      '{"scores":[{"score":"77%"},{"score":"83/100"}]}',
      2,
    );
    expect(parsed?.entries.map((entry) => entry.score)).toEqual([77, 83]);
  });

  test("a 0-10 answer is widened to 0-100", () => {
    const parsed = parseImageJudgement('{"scores":[{"score":7},{"score":9}]}', 2);
    expect(parsed?.entries.map((entry) => entry.score)).toEqual([70, 90]);
  });

  test("a missing best falls back to the highest score", () => {
    const parsed = parseImageJudgement('{"scores":[{"score":40},{"score":95}]}', 2);
    expect(parsed?.best).toBe(1);
  });

  test("an out-of-range best falls back rather than pointing at nothing", () => {
    const parsed = parseImageJudgement(
      '{"scores":[{"score":40},{"score":95}],"best":9}',
      2,
    );
    expect(parsed?.best).toBe(1);
  });

  test("an unscored image stays at zero instead of inventing a number", () => {
    const parsed = parseImageJudgement('{"scores":[{"image":2,"score":88}]}', 2);
    expect(parsed?.entries[0].score).toBe(0);
    expect(parsed?.best).toBe(1);
  });

  test("the refine prompt is cleaned of preamble and labels", () => {
    const parsed = parseImageJudgement(
      JSON.stringify({
        scores: [{ score: 60 }],
        refine: "Here's the improved prompt: **Prompt:** a red fox asleep in deep snow, soft dawn light, 85mm",
      }),
      1,
    );
    expect(parsed?.refine).toBe(
      "a red fox asleep in deep snow, soft dawn light, 85mm",
    );
  });

  test("unreadable answers are null, never a fabricated score", () => {
    expect(parseImageJudgement("I could not open the images.", 2)).toBeNull();
    expect(parseImageJudgement("", 2)).toBeNull();
    expect(parseImageJudgement('{"scores":[]}', 2)).toBeNull();
    expect(parseImageJudgement('{"scores":[{"score":80}]}', 0)).toBeNull();
  });
});
