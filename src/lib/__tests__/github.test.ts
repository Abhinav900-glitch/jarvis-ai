import { describe, expect, test } from "bun:test";
import { parseRepo, repoPath, repoSlug } from "../github";

describe("parseRepo", () => {
  test("reads owner/name", () => {
    expect(parseRepo("convex-dev/convex")).toEqual({
      owner: "convex-dev",
      name: "convex",
    });
  });

  test("accepts a github.com URL, with or without a path inside the repo", () => {
    expect(parseRepo("https://github.com/vercel/next.js")).toEqual({
      owner: "vercel",
      name: "next.js",
    });
    expect(parseRepo("https://github.com/vercel/next.js/tree/canary/packages")).toEqual({
      owner: "vercel",
      name: "next.js",
    });
    expect(parseRepo("www.github.com/owner/name")).toEqual({
      owner: "owner",
      name: "name",
    });
  });

  test("strips the .git suffix and clone syntax", () => {
    expect(parseRepo("git@github.com:owner/name.git")).toEqual({
      owner: "owner",
      name: "name",
    });
    expect(parseRepo("https://github.com/owner/name.git")).toEqual({
      owner: "owner",
      name: "name",
    });
  });

  test("ignores query strings, fragments and trailing slashes", () => {
    expect(parseRepo("https://github.com/owner/name/?tab=readme#install")).toEqual({
      owner: "owner",
      name: "name",
    });
  });

  test("refuses anything that is not a repository", () => {
    expect(parseRepo("")).toBeNull();
    expect(parseRepo("convex")).toBeNull();
    expect(parseRepo("https://example.com/owner/name")).toBeNull();
    expect(parseRepo("owner/na me")).toBeNull();
    expect(parseRepo("owner/../etc")).toBeNull();
  });
});

describe("repoPath", () => {
  test("root is the empty string", () => {
    expect(repoPath(undefined)).toBe("");
    expect(repoPath("")).toBe("");
    expect(repoPath("/")).toBe("");
  });

  test("normalizes surrounding slashes", () => {
    expect(repoPath("/src/lib/")).toBe("src/lib");
    expect(repoPath("src//lib//a.ts")).toBe("src/lib/a.ts");
  });

  test("refuses a path that walks up", () => {
    expect(repoPath("src/../../etc")).toBeNull();
  });
});

describe("repoSlug", () => {
  test("joins owner and name", () => {
    expect(repoSlug({ owner: "a", name: "b" })).toBe("a/b");
  });
});
