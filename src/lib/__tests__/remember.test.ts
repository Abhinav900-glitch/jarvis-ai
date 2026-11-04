import { describe, expect, test } from "bun:test";
import { MEMORY_MAX, memoryExcerpt } from "../remember";

describe("memoryExcerpt", () => {
  test("strips bold, italic and heading marks", () => {
    expect(memoryExcerpt("## Result\n\n**Cambria** works better for _long_ docs.")).toBe(
      "Result Cambria works better for long docs.",
    );
  });

  test("drops fenced code but keeps the prose around it", () => {
    const text = "Run this:\n\n```ts\nconst x = 1;\n```\n\nThen it works.";
    expect(memoryExcerpt(text)).toBe("Run this: Then it works.");
  });

  test("keeps link text and drops the target", () => {
    expect(memoryExcerpt("See [the spec](https://example.com/a?b=1) for detail.")).toBe(
      "See the spec for detail.",
    );
  });

  test("keeps inline code content", () => {
    expect(memoryExcerpt("Prefers `bun test` over npm.")).toBe(
      "Prefers bun test over npm.",
    );
  });

  test("strips list bullets and collapses whitespace", () => {
    expect(memoryExcerpt("- one\n+ two\n\n  three")).toBe("one two three");
  });

  test("returns empty for markup-only content", () => {
    expect(memoryExcerpt("```js\nconst a = 1;\n```")).toBe("");
    expect(memoryExcerpt("   \n\n")).toBe("");
  });

  test("caps at the server's limit and marks the cut", () => {
    const long = "word ".repeat(200);
    const out = memoryExcerpt(long);
    expect(out.length).toBeLessThanOrEqual(MEMORY_MAX);
    expect(out.endsWith("…")).toBe(true);
  });
});
