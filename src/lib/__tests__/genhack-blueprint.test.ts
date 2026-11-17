// GenHack's promise in tests: for every stack, a brief produces a project of
// 100+ files and 1000+ lines that passes its own checker with zero errors.
//
// Running the checker over the generator is how the templates stay honest — a
// renamed import in one template shows up here as a broken reference in the
// other forty files that use it.

import { describe, expect, test } from "bun:test";
import { DEFAULT_FILES, MAX_FILES, buildBlueprint, clampTarget, entitiesFor, isStackId } from "../genhack/blueprint";
import { checkBalance, checkImports, checkProject, countLines, joinPath } from "../genhack/check";
import type { StackId } from "../genhack/types";

const BRIEF = "An operations dashboard for a small logistics team";
const STACKS: StackId[] = ["react", "node", "python"];

describe("blueprint", () => {
  for (const stack of STACKS) {
    const blueprint = buildBlueprint({ brief: BRIEF, stack, targetFiles: DEFAULT_FILES });
    const result = checkProject(blueprint.files.map((f) => ({ path: f.path, content: f.content })));

    test(stack + ": writes 100+ files and 1000+ lines", () => {
      expect(blueprint.files.length).toBeGreaterThanOrEqual(100);
      expect(blueprint.lines).toBeGreaterThanOrEqual(1000);
      expect(blueprint.lines).toBe(countLines(blueprint.files));
    });

    test(stack + ": passes its own checks with zero errors", () => {
      const errors = result.issues.filter((issue) => issue.severity === "error");
      expect(errors).toEqual([]);
      expect(result.files).toBe(blueprint.files.length);
    });

    test(stack + ": paths are unique and POSIX", () => {
      const paths = blueprint.files.map((file) => file.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const path of paths) {
        expect(path.startsWith("/")).toBe(false);
        expect(path.includes("\\")).toBe(false);
        expect(path.includes("PKG")).toBe(false);
      }
    });

    test(stack + ": every file has content and a role", () => {
      for (const file of blueprint.files) {
        expect(file.content.trim().length).toBeGreaterThan(0);
        expect(file.role.length).toBeGreaterThan(0);
      }
    });
  }

  test("is deterministic: same brief, same bytes", () => {
    const first = buildBlueprint({ brief: BRIEF, stack: "node" });
    const second = buildBlueprint({ brief: BRIEF, stack: "node" });
    expect(first.files.map((file) => file.path)).toEqual(second.files.map((file) => file.path));
    expect(first.files[12].content).toBe(second.files[12].content);
  });

  test("a bigger target writes more files, up to the ceiling", () => {
    const small = buildBlueprint({ brief: BRIEF, stack: "react", targetFiles: 40 });
    const large = buildBlueprint({ brief: BRIEF, stack: "react", targetFiles: MAX_FILES });
    expect(large.files.length).toBeGreaterThan(small.files.length);
    expect(large.files.length).toBeLessThanOrEqual(MAX_FILES + 40);
    expect(clampTarget(10_000)).toBe(MAX_FILES);
    expect(clampTarget(0)).toBe(40);
  });

  test("the brief becomes the name, title and docs", () => {
    const blueprint = buildBlueprint({ brief: "A bookings dashboard for a hotel group", stack: "react" });
    expect(blueprint.name).toBe("a-bookings-dashboard-for-a-hotel-group");
    expect(blueprint.title).toBe("A Bookings Dashboard For A Hotel");
    expect(blueprint.files.some((file) => file.content.includes("bookings dashboard"))).toBe(true);
  });

  test("an empty brief still produces a usable project", () => {
    const blueprint = buildBlueprint({ brief: "   ", stack: "python" });
    expect(blueprint.files.length).toBeGreaterThan(80);
    expect(blueprint.name).toBe("a-small-operations-dashboard");
  });

  test("stacks are recognised, entity counts scale with the target", () => {
    expect(isStackId("react")).toBe(true);
    expect(isStackId("rust")).toBe(false);
    expect(entitiesFor("react", 120).length).toBeGreaterThan(4);
    expect(entitiesFor("react", 40)).toHaveLength(4);
  });
});

describe("checker", () => {
  test("an unclosed brace is an error with a line number", () => {
    const issues = checkBalance("src/a.ts", "export function a() {\n  return 1;\n");
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(1);
  });

  test("a brace inside a string is not a brace", () => {
    expect(checkBalance("src/a.ts", 'const x = "{ not code";\n')).toEqual([]);
    expect(checkBalance("src/a.ts", "// {\nconst y = 1;\n")).toEqual([]);
  });

  test("mismatched closers name both lines", () => {
    const issues = checkBalance("src/a.ts", "function a() {\n  call(];\n}\n");
    expect(issues[0].message).toContain("line 2");
  });

  test("python triple-quoted strings are skipped", () => {
    const source = '"""A docstring with { and ( inside."""\n\ndef f() -> int:\n    return 1\n';
    expect(checkBalance("a.py", source)).toEqual([]);
  });

  test("a relative import with no file is caught", () => {
    const issues = checkImports([
      { path: "src/a.ts", content: 'import { x } from "./missing";' },
      { path: "src/b.ts", content: 'import { y } from "./a";' },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("./missing");
  });

  test("folder imports resolve to index files", () => {
    expect(
      checkImports([
        { path: "src/a.ts", content: 'import { x } from "./feature";' },
        { path: "src/feature/index.ts", content: "export const x = 1;" },
      ]),
    ).toEqual([]);
  });

  test("broken JSON is an error", () => {
    const result = checkProject([{ path: "package.json", content: '{ "name": "x", }' }]);
    expect(result.errors).toBe(1);
  });

  test("joinPath walks up without a filesystem", () => {
    expect(joinPath("src/features/orders", "../types")).toBe("src/features/types");
    expect(joinPath("src", "./a/./b")).toBe("src/a/b");
  });
});
