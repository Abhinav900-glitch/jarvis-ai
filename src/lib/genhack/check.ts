// ---------------------------------------------------------------------------
// GenHack's checker.
//
// Every file the writer produces — from a template or from a model — passes
// through here before it is counted as written. It is not a compiler: it is the
// cheap, offline gate that catches the failures that actually happen when code
// is generated in bulk: a truncated file with an unclosed brace, a stray
// bracket in a JSX tree, an import pointing at a file the project never got,
// invalid JSON in package.json.
//
// It has to be right about strings and comments, or every file containing
// "{" inside a string is a false positive. The scanner below is small on
// purpose but it does understand quotes, escapes, line comments, block
// comments and Python's triple-quoted strings.
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning";

export interface FileIssue {
  path: string;
  line?: number;
  message: string;
  severity: Severity;
}

export interface CheckResult {
  issues: FileIssue[];
  errors: number;
  warnings: number;
  files: number;
  lines: number;
}

interface Open {
  char: string;
  line: number;
}

const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/**
 * Brackets, checked outside of strings and comments.
 *
 * A generated file that ends mid-expression is the single most common failure
 * of a model writing code, and it is invisible until someone runs it.
 */
export function checkBalance(path: string, source: string): FileIssue[] {
  const issues: FileIssue[] = [];
  const stack: Open[] = [];
  let line = 1;
  let i = 0;
  let state: "code" | "single" | "double" | "triple-single" | "triple-double" | "line" | "block" = "code";
  const isPython = path.endsWith(".py");

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") {
      line += 1;
      if (state === "line") state = "code";
      i += 1;
      continue;
    }

    if (state === "line") {
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "single" || state === "double") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if ((state === "single" && ch === "'") || (state === "double" && ch === '"')) state = "code";
      i += 1;
      continue;
    }
    if (state === "triple-single" || state === "triple-double") {
      const quote = state === "triple-single" ? "'" : '"';
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote && next === quote && source[i + 2] === quote) {
        state = "code";
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    // state === "code"
    if (ch === "/" && next === "/" && !isPython) {
      state = "line";
      i += 2;
      continue;
    }
    if (ch === "#" && isPython) {
      state = "line";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "block";
      i += 2;
      continue;
    }
    if (isPython && (source.startsWith("'''", i) || source.startsWith('"""', i))) {
      state = source.startsWith("'''", i) ? "triple-single" : "triple-double";
      i += 3;
      continue;
    }
    if (ch === "'") {
      state = "single";
      i += 1;
      continue;
    }
    if (ch === '"') {
      state = "double";
      i += 1;
      continue;
    }
    if (ch === "`") {
      // Template literals: the expression inside ${} is real code, but for the
      // purpose of bracket balance it is enough to skip the whole literal —
      // an unbalanced brace inside an interpolation is a rarer bug than the
      // false positives the alternative creates.
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "`") break;
        if (source[i] === "\n") line += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (OPENERS.has(ch)) {
      stack.push({ char: ch, line });
      i += 1;
      continue;
    }
    if (CLOSERS.has(ch)) {
      const top = stack.pop();
      if (!top) {
        issues.push({
          path,
          line,
          message: `Closing "${ch}" has no matching opener.`,
          severity: "error",
        });
      } else if (top.char !== PAIRS[ch]) {
        issues.push({
          path,
          line,
          message: `"${ch}" closes "${top.char}" opened on line ${top.line}.`,
          severity: "error",
        });
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  if (state === "block") {
    issues.push({ path, line, message: "A block comment is never closed.", severity: "error" });
  }
  const last = stack.pop();
  if (last) {
    issues.push({
      path,
      line: last.line,
      message: `"${last.char}" opened here is never closed.`,
      severity: "error",
    });
  }
  return issues;
}

/** A file that is a comment and nothing else is not code. */
function checkSubstance(path: string, source: string): FileIssue[] {
  const issues: FileIssue[] = [];
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|#).*$/gm, "").trim();
  if (body.length === 0) {
    issues.push({ path, message: "The file is empty apart from comments.", severity: "error" });
    return issues;
  }
  if (/\b(TODO|FIXME|YOUR[_ ]CODE[_ ]HERE)\b/.test(body) && body.length < 120) {
    issues.push({ path, message: "The file is a placeholder, not an implementation.", severity: "warning" });
  }
  return issues;
}

const IMPORT_PATTERNS = [
  /(?:^|\s)from\s+["']([^"']+)["']/g,
  /(?:^|\s)import\s+(?:[^"'`\n]*?\s+from\s+)?["']([^"']+)["']/g,
  /require\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|\s)import\(\s*["']([^"']+)["']\s*\)/g,
];

/** POSIX-join two parts, resolving "." and ".." without a filesystem. */
export function joinPath(dir: string, spec: string): string {
  const parts = dir === "" ? [] : dir.split("/");
  const out = [...parts];
  for (const piece of spec.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") out.pop();
    else out.push(piece);
  }
  return out.join("/");
}

const RESOLVE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".css",
  ".json",
  ".py",
  ".md",
  ".yml",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/__init__.py",
  "/mod.rs",
];

/**
 * Every relative import must name a file this project actually has.
 *
 * `expected` is the plan's full path list. A project is written in batches, so
 * an early file legitimately imports a file that exists in the plan but not on
 * disk yet — that is pending, not broken, and reporting it as an error would
 * make every in-progress project look wrong.
 */
export function checkImports(
  files: { path: string; content: string }[],
  expected: Iterable<string> = [],
): FileIssue[] {
  const issues: FileIssue[] = [];
  const known = new Set(files.map((file) => file.path));
  const planned = new Set(expected);

  for (const file of files) {
    // Stylesheets and assets are legitimate import targets but never import
    // anything themselves, so they count as known without being scanned.
    if (!/\.(ts|tsx|js|jsx|mjs|py)$/.test(file.path)) continue;
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    // The patterns overlap on purpose (a `from` import also looks like an
    // `import`), so each occurrence is reported once by its position.
    const seen = new Set<string>();
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(file.content))) {
        const spec = match[1];
        if (!spec.startsWith(".")) continue;
        const line = file.content.slice(0, match.index).split("\n").length;
        const key = line + ":" + spec;
        if (seen.has(key)) continue;
        seen.add(key);
        const base = joinPath(dir, spec);
        const resolved = RESOLVE_SUFFIXES.some((suffix) => known.has(base + suffix));
        const pending = RESOLVE_SUFFIXES.some((suffix) => planned.has(base + suffix));
        if (!resolved && !pending) {
          issues.push({
            path: file.path,
            line,
            message: `Imports "${spec}", which this project never writes.`,
            severity: "error",
          });
        }
      }
    }
  }
  return issues;
}

export function checkFile(path: string, content: string): FileIssue[] {
  const issues: FileIssue[] = [];
  if (content.trim().length === 0) {
    return [{ path, message: "The file has no content.", severity: "error" }];
  }
  if (path.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (err) {
      issues.push({
        path,
        message: `Invalid JSON: ${err instanceof Error ? err.message : "unknown error"}`,
        severity: "error",
      });
    }
    return issues;
  }
  issues.push(...checkBalance(path, content));
  issues.push(...checkSubstance(path, content));
  return issues;
}

export function countLines(files: { content: string }[]): number {
  return files.reduce((sum, file) => sum + (file.content ? file.content.split("\n").length : 0), 0);
}

/** The whole project: per-file checks, then the import graph. */
export function checkProject(
  files: { path: string; content: string }[],
  options: { expected?: Iterable<string> } = {},
): CheckResult {
  const issues: FileIssue[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (seen.has(file.path)) {
      issues.push({ path: file.path, message: "Two files share this path.", severity: "error" });
      continue;
    }
    seen.add(file.path);
    issues.push(...checkFile(file.path, file.content));
  }
  issues.push(...checkImports(files, options.expected ?? []));

  return {
    issues,
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    files: files.length,
    lines: countLines(files),
  };
}
