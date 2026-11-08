import { describe, expect, test } from "bun:test";

import {
  ENHANCE_LIMIT,
  cleanEnhancedPrompt,
  enhancePromptRequest,
} from "@/lib/enhance-prompt";

const base = "a lighthouse in a storm";

describe("enhancePromptRequest", () => {
  test("carries the description and every choice the user made", () => {
    const text = enhancePromptRequest({
      prompt: base,
      style: "oil painting, textured brushwork",
      instructions: "from above, golden hour",
      avoid: "text, watermarks",
    });
    expect(text).toContain(base);
    expect(text).toContain("oil painting, textured brushwork");
    expect(text).toContain("from above, golden hour");
    expect(text).toContain("text, watermarks");
  });

  test("omits parts the user left blank", () => {
    const text = enhancePromptRequest({ prompt: base, style: "  ", instructions: "" });
    expect(text.split("\n")).toHaveLength(1);
    expect(text).not.toContain("Style already chosen");
    expect(text).not.toContain("They also asked for");
    expect(text).not.toContain("They do not want");
  });
});

describe("cleanEnhancedPrompt", () => {
  test("keeps a plain answer as written", () => {
    const answer = "A tall white lighthouse on black rocks, lightning behind it, long exposure";
    expect(cleanEnhancedPrompt(answer, base)).toBe(answer);
  });

  test("unwraps a fenced block", () => {
    expect(
      cleanEnhancedPrompt("```\nA red panda on a mossy branch, soft rain\n```", base),
    ).toBe("A red panda on a mossy branch, soft rain");
  });

  test("drops a preamble line but keeps the prompt", () => {
    expect(
      cleanEnhancedPrompt(
        "Here's a sharper prompt:\n\nA lone lighthouse, waves breaking over the rocks, dusk",
        base,
      ),
    ).toBe("A lone lighthouse, waves breaking over the rocks, dusk");
  });

  test("joins a bulleted answer without its markers", () => {
    expect(
      cleanEnhancedPrompt("- a lighthouse\n- storm waves\n2. dusk light", base),
    ).toBe("a lighthouse storm waves dusk light");
  });

  test("strips a label and wrapping quotes", () => {
    expect(
      cleanEnhancedPrompt('**Improved prompt:** "A glass tower at dawn"', base),
    ).toBe("A glass tower at dawn");
  });

  test("falls back when the answer is empty", () => {
    expect(cleanEnhancedPrompt("   \n  ", base)).toBe(base);
  });

  test("falls back when the answer is not a description", () => {
    expect(cleanEnhancedPrompt("ok", base)).toBe(base);
  });

  test("falls back when the answer repeats the input", () => {
    expect(cleanEnhancedPrompt("A Lighthouse In A Storm", base)).toBe(base);
  });

  test("caps the length on a word boundary", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const out = cleanEnhancedPrompt(long, base);
    expect(out.length).toBeLessThanOrEqual(ENHANCE_LIMIT);
    // No half word at the end.
    expect(long.startsWith(out)).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
  });
});
