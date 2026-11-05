import { describe, expect, test } from "bun:test";
import { languageForPath, toolSpecs } from "../agent-tools";

const names = (mode: "readonly" | "auto" | "ask") =>
  toolSpecs(mode).map((spec) => spec.function.name);

describe("languageForPath", () => {
  test("maps the extensions a runner can take", () => {
    expect(languageForPath("main.py")).toBe("python3");
    expect(languageForPath("src/check.js")).toBe("nodejs");
    expect(languageForPath("bin/task.mjs")).toBe("nodejs");
    expect(languageForPath("script.rb")).toBe("ruby");
    expect(languageForPath("setup.sh")).toBe("bash");
    expect(languageForPath("main.go")).toBe("go");
    expect(languageForPath("engine.rs")).toBe("rust");
    expect(languageForPath("Main.java")).toBe("java");
    expect(languageForPath("lib.cpp")).toBe("cpp");
    expect(languageForPath("lib.h")).toBe("c");
    expect(languageForPath("Program.cs")).toBe("csharp");
  });

  test("is case-insensitive about the extension", () => {
    expect(languageForPath("MAIN.PY")).toBe("python3");
    expect(languageForPath("App.JS")).toBe("nodejs");
  });

  test("refuses files no runner can execute on its own", () => {
    // TypeScript is deliberately absent: node would fail on the syntax, and a
    // syntax error is not a signal about the code.
    expect(languageForPath("app.ts")).toBeNull();
    expect(languageForPath("view.tsx")).toBeNull();
    expect(languageForPath("README.md")).toBeNull();
    expect(languageForPath("Makefile")).toBeNull();
    expect(languageForPath("archive.tar.gz")).toBeNull();
    expect(languageForPath(".gitignore")).toBeNull();
    expect(languageForPath("")).toBeNull();
  });
});

describe("toolSpecs", () => {
  test("offers run_file alongside run_code", () => {
    const listed = names("auto");
    expect(listed).toContain("run_file");
    expect(listed).toContain("run_code");
    expect(listed).toContain("write_file");
  });

  test("run_file takes a path and nothing else required", () => {
    const spec = toolSpecs("auto").find(
      (s) => s.function.name === "run_file",
    );
    expect(spec?.function.parameters?.required).toEqual(["path"]);
  });

  test("readonly mode drops everything that can change or execute", () => {
    const listed = names("readonly");
    expect(listed).not.toContain("run_file");
    expect(listed).not.toContain("run_code");
    expect(listed).not.toContain("write_file");
    expect(listed).toContain("read_file");
  });
});
