import { describe, expect, test } from "bun:test";
import { imageFileName } from "../download-image";

const at = new Date(2026, 10, 8, 9, 4); // 8 Nov 2026, 09:04 local

describe("imageFileName", () => {
  test("slugs the prompt and stamps the minute", () => {
    expect(imageFileName("https://cdn.example/a.jpg", "A Fox in Morning Fog!", at)).toBe(
      "a-fox-in-morning-fog-20261108-0904.jpg",
    );
  });

  test("takes the extension from the URL path, not from a query string", () => {
    expect(imageFileName("https://cdn.example/a.webp?w=1200&fmt=webp", "x", at)).toBe(
      "x-20261108-0904.webp",
    );
    expect(imageFileName("https://cdn.example/photo.jpeg", "", at)).toBe(
      "jarvis-image-20261108-0904.jpg",
    );
  });

  test("extensionless CDNs default to jpg", () => {
    expect(imageFileName("https://images.example/get?id=9", "aurora", at)).toBe(
      "aurora-20261108-0904.jpg",
    );
  });

  test("no hint still gives a findable name", () => {
    expect(imageFileName("https://cdn.example/a.png", "   ", at)).toBe(
      "jarvis-image-20261108-0904.png",
    );
  });

  test("long prompts are cut without a trailing dash", () => {
    const name = imageFileName(
      "https://cdn.example/a.png",
      "a very long description of an extremely detailed scene with many words in it",
      at,
    );
    expect(name.startsWith("a-very-long-description")).toBe(true);
    // 48 characters of slug, then the timestamp and extension.
    expect(name).toMatch(/^[a-z0-9-]{1,48}-20261108-0904\.png$/);
    // The cut never leaves a dangling dash before the timestamp.
    expect(name).not.toContain("--");
  });

  test("accents are folded rather than dropped", () => {
    expect(imageFileName("https://cdn.example/a.jpg", "Café au lait", at)).toContain(
      "cafe-au-lait",
    );
  });

  test("a non-URL string does not throw", () => {
    expect(imageFileName("not a url.jpg", "x", at)).toBe("x-20261108-0904.jpg");
  });
});
