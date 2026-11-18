import { describe, expect, test } from "bun:test";
import { BING_CREATOR_URL, BING_PROMPT_LIMIT, bingCreatorUrl } from "../bing-image";

describe("bingCreatorUrl", () => {
  test("puts the prompt in the query string", () => {
    const url = bingCreatorUrl("A red fox in snow, photorealistic");
    expect(url).toContain(BING_CREATOR_URL);
    expect(new URL(url!).searchParams.get("q")).toBe(
      "A red fox in snow, photorealistic",
    );
  });

  test("collapses the newlines a prompt may have been typed with", () => {
    const url = bingCreatorUrl("a fox\n\n  in snow ");
    expect(new URL(url!).searchParams.get("q")).toBe("a fox in snow");
  });

  test("an empty prompt is no link at all", () => {
    expect(bingCreatorUrl("")).toBeNull();
    expect(bingCreatorUrl("   \n ")).toBeNull();
  });

  test("a long prompt is clipped on a word boundary, never mid-word", () => {
    const url = bingCreatorUrl("dragon ".repeat(120));
    const q = new URL(url!).searchParams.get("q")!;
    expect(q.length).toBeLessThanOrEqual(BING_PROMPT_LIMIT);
    expect(q.endsWith("dragon")).toBe(true);
  });
});
