// ---------------------------------------------------------------------------
// The languages the code runner offers.
//
// JDoodle identifies a language by a slug ("python3", "nodejs", "cpp17") and a
// run by `versionIndex` — which is a POSITION in that language's version list,
// counting from zero. It is emphatically not a version number, and index "0"
// is usually the oldest release still supported rather than the newest. So
// every language here pins an explicit `defaultVersion` that was read off
// JDoodle's own version table; we never send "0" on the user's behalf.
// ---------------------------------------------------------------------------

export interface CodeVersion {
  /** The position JDoodle expects in `versionIndex`. */
  index: number;
  label: string;
}

export interface CodeLanguage {
  /** JDoodle's `language` slug. */
  id: string;
  label: string;
  /** File extension, used when the source is copied or downloaded. */
  ext: string;
  /** Language tag for Markdown fences, so pasted code highlights correctly. */
  fence: string;
  /** Single-line comment token, shown in the editor gutter hint. */
  comment: string;
  versions: CodeVersion[];
  /** Index into `versions` used when the user has not chosen one. */
  defaultVersion: number;
  /** Whether the editor offers a stdin box for this language. */
  stdin: boolean;
  /** Rough grouping, used to keep the language list readable. */
  group: string;
  /**
   * The OnlineCompiler.io identifier for this language, when it has one.
   *
   * That fallback service runs a much smaller list, and exactly one version of
   * each — so `versions` above is ignored there and the run happens on whatever
   * release it ships. Languages without this field simply cannot fall back.
   */
  onlineCompiler?: string;
}

/**
 * The offered subset. JDoodle itself runs 114 languages; this is the set that
 * covers everyday scripting, systems work, the JVM and the web, ordered so the
 * most-used ones sit at the top of the picker.
 */
export const CODE_LANGUAGES: CodeLanguage[] = [
  {
    id: "python3",
    label: "Python 3",
    ext: "py",
    fence: "python",
    comment: "#",
    group: "Scripting",
    stdin: true,
    onlineCompiler: "python-3.14",
    versions: [
      { index: 0, label: "3.5.1" },
      { index: 1, label: "3.6.3" },
      { index: 2, label: "3.6.5" },
      { index: 3, label: "3.7.4" },
      { index: 4, label: "3.9.9" },
      { index: 5, label: "3.11.5" },
      { index: 6, label: "3.14.3" },
    ],
    defaultVersion: 5,
  },
  {
    id: "nodejs",
    label: "Node.js",
    ext: "js",
    fence: "javascript",
    comment: "//",
    group: "Web",
    stdin: true,
    versions: [
      { index: 0, label: "6.3.1" },
      { index: 1, label: "9.2.0" },
      { index: 2, label: "10.1.0" },
      { index: 3, label: "12.11.1" },
      { index: 4, label: "17.1.0" },
      { index: 5, label: "20.9.0 LTS" },
      { index: 6, label: "21.2.0" },
      { index: 7, label: "25.8.1" },
    ],
    defaultVersion: 5,
  },
  {
    id: "java",
    label: "Java",
    ext: "java",
    fence: "java",
    comment: "//",
    group: "JVM",
    stdin: true,
    onlineCompiler: "openjdk-25",
    versions: [
      { index: 0, label: "JDK 8" },
      { index: 1, label: "JDK 9" },
      { index: 2, label: "JDK 10" },
      { index: 3, label: "JDK 11" },
      { index: 4, label: "JDK 17" },
      { index: 5, label: "JDK 21" },
      { index: 6, label: "JDK 25" },
    ],
    defaultVersion: 5,
  },
  {
    id: "c",
    label: "C",
    ext: "c",
    fence: "c",
    comment: "//",
    group: "Systems",
    stdin: true,
    onlineCompiler: "gcc-15",
    versions: [
      { index: 0, label: "GCC 5.3" },
      { index: 2, label: "GCC 7.2" },
      { index: 3, label: "GCC 8.1" },
      { index: 4, label: "GCC 9.1" },
      { index: 5, label: "GCC 11.1" },
      { index: 6, label: "GCC 13.2" },
      { index: 7, label: "GCC 15.2" },
    ],
    defaultVersion: 5,
  },
  {
    id: "cpp",
    label: "C++",
    ext: "cpp",
    fence: "cpp",
    comment: "//",
    group: "Systems",
    stdin: true,
    onlineCompiler: "g++-15",
    versions: [
      { index: 0, label: "GCC 5.3" },
      { index: 2, label: "GCC 7.2" },
      { index: 3, label: "GCC 8.1" },
      { index: 4, label: "GCC 9.1" },
      { index: 5, label: "GCC 11.1" },
      { index: 6, label: "GCC 13.2" },
      { index: 7, label: "GCC 15.2" },
    ],
    defaultVersion: 5,
  },
  {
    id: "cpp17",
    label: "C++17",
    ext: "cpp",
    fence: "cpp",
    comment: "//",
    group: "Systems",
    stdin: true,
    versions: [
      { index: 0, label: "g++17 GCC 9.1" },
      { index: 1, label: "g++17 GCC 11.1" },
      { index: 2, label: "g++17 GCC 13.2" },
      { index: 3, label: "g++17 GCC 15.2" },
    ],
    defaultVersion: 1,
  },
  {
    id: "csharp",
    label: "C#",
    ext: "cs",
    fence: "csharp",
    comment: "//",
    group: "JVM",
    stdin: true,
    onlineCompiler: "dotnet-csharp-9",
    versions: [
      { index: 0, label: "Mono 4.2" },
      { index: 3, label: "Mono 6.0" },
      { index: 4, label: "Mono 6.12" },
      { index: 5, label: ".NET 7" },
      { index: 6, label: ".NET 10" },
    ],
    defaultVersion: 5,
  },
  {
    id: "go",
    label: "Go",
    ext: "go",
    fence: "go",
    comment: "//",
    group: "Systems",
    stdin: true,
    onlineCompiler: "go-1.26",
    versions: [
      { index: 0, label: "1.5.2" },
      { index: 3, label: "1.13.1" },
      { index: 4, label: "1.17.3" },
      { index: 5, label: "1.21.4" },
      { index: 6, label: "1.26.1" },
    ],
    defaultVersion: 5,
  },
  {
    id: "rust",
    label: "Rust",
    ext: "rs",
    fence: "rust",
    comment: "//",
    group: "Systems",
    stdin: true,
    onlineCompiler: "rust-1.93",
    versions: [
      { index: 3, label: "1.38.0" },
      { index: 4, label: "1.56.1" },
      { index: 5, label: "1.73.0" },
      { index: 6, label: "1.94.0" },
    ],
    defaultVersion: 6,
  },
  {
    id: "typescript",
    label: "TypeScript",
    ext: "ts",
    fence: "ts",
    comment: "//",
    group: "Web",
    stdin: true,
    onlineCompiler: "typescript-deno",
    versions: [
      { index: 0, label: "5.2.2" },
      { index: 1, label: "5.9.3" },
    ],
    defaultVersion: 1,
  },
  {
    id: "html",
    label: "HTML / CSS / JS",
    ext: "html",
    fence: "html",
    comment: "//",
    group: "Web",
    stdin: false,
    versions: [{ index: 0, label: "single version" }],
    defaultVersion: 0,
  },
  {
    id: "reactjs",
    label: "React",
    ext: "jsx",
    fence: "jsx",
    comment: "//",
    group: "Web",
    stdin: false,
    versions: [{ index: 0, label: "single version" }],
    defaultVersion: 0,
  },
  {
    id: "sql",
    label: "SQL (SQLite)",
    ext: "sql",
    fence: "sql",
    comment: "--",
    group: "Data",
    stdin: true,
    versions: [
      { index: 0, label: "SQLite 3.9.2" },
      { index: 4, label: "SQLite 3.37" },
      { index: 5, label: "SQLite 3.44" },
      { index: 6, label: "SQLite 3.49" },
    ],
    defaultVersion: 6,
  },
  {
    id: "bash",
    label: "Bash",
    ext: "sh",
    fence: "bash",
    comment: "#",
    group: "Scripting",
    stdin: true,
    versions: [
      { index: 0, label: "4.3" },
      { index: 2, label: "4.4.19" },
      { index: 4, label: "5.1.12" },
      { index: 5, label: "5.2.15" },
      { index: 6, label: "5.2.37" },
    ],
    defaultVersion: 6,
  },
  {
    id: "ruby",
    label: "Ruby",
    ext: "rb",
    fence: "ruby",
    comment: "#",
    group: "Scripting",
    stdin: true,
    onlineCompiler: "ruby-4.0",
    versions: [
      { index: 2, label: "2.5.1" },
      { index: 3, label: "2.6.5" },
      { index: 4, label: "3.0.2" },
      { index: 5, label: "3.0.6" },
      { index: 6, label: "3.4.8" },
    ],
    defaultVersion: 6,
  },
  {
    id: "php",
    label: "PHP",
    ext: "php",
    fence: "php",
    comment: "//",
    group: "Web",
    stdin: true,
    onlineCompiler: "php-8.5",
    versions: [
      { index: 1, label: "7.1.11" },
      { index: 3, label: "7.3.10" },
      { index: 4, label: "8.0.13" },
      { index: 5, label: "8.2.12" },
      { index: 6, label: "8.5.4" },
    ],
    defaultVersion: 5,
  },
  {
    id: "kotlin",
    label: "Kotlin",
    ext: "kt",
    fence: "kotlin",
    comment: "//",
    group: "JVM",
    stdin: true,
    versions: [
      { index: 2, label: "1.3.50" },
      { index: 3, label: "1.6.0" },
      { index: 4, label: "1.9.10" },
      { index: 5, label: "2.3.10" },
    ],
    defaultVersion: 4,
  },
  {
    id: "swift",
    label: "Swift",
    ext: "swift",
    fence: "swift",
    comment: "//",
    group: "Systems",
    stdin: true,
    versions: [
      { index: 2, label: "4.1" },
      { index: 3, label: "5.1" },
      { index: 4, label: "5.5" },
      { index: 5, label: "5.9.1" },
      { index: 6, label: "6.2.4" },
    ],
    defaultVersion: 5,
  },
  {
    id: "scala",
    label: "Scala",
    ext: "scala",
    fence: "scala",
    comment: "//",
    group: "JVM",
    stdin: true,
    versions: [
      { index: 1, label: "2.12.4" },
      { index: 3, label: "2.13.0" },
      { index: 4, label: "2.13.6" },
      { index: 6, label: "2.13.16" },
    ],
    defaultVersion: 6,
  },
  {
    id: "r",
    label: "R",
    ext: "r",
    fence: "r",
    comment: "#",
    group: "Data",
    stdin: true,
    versions: [
      { index: 2, label: "3.5.0" },
      { index: 3, label: "3.6.1" },
      { index: 5, label: "4.3.2" },
      { index: 6, label: "4.5.3" },
    ],
    defaultVersion: 6,
  },
  {
    id: "lua",
    label: "Lua",
    ext: "lua",
    fence: "lua",
    comment: "--",
    group: "Scripting",
    stdin: true,
    versions: [
      { index: 0, label: "5.3.2" },
      { index: 3, label: "5.4.3" },
      { index: 5, label: "5.4.8" },
    ],
    defaultVersion: 5,
  },
  {
    id: "perl",
    label: "Perl",
    ext: "pl",
    fence: "perl",
    comment: "#",
    group: "Scripting",
    stdin: true,
    versions: [
      { index: 2, label: "5.26.2" },
      { index: 4, label: "5.34.0" },
      { index: 5, label: "5.38.0" },
      { index: 6, label: "5.42.0" },
    ],
    defaultVersion: 6,
  },
  {
    id: "haskell",
    label: "Haskell",
    ext: "hs",
    fence: "haskell",
    comment: "--",
    group: "Functional",
    stdin: true,
    onlineCompiler: "haskell-9.12",
    versions: [
      { index: 1, label: "GHC 8.2.1" },
      { index: 3, label: "GHC 8.6.5" },
      { index: 4, label: "GHC 9.0.1" },
      { index: 6, label: "GHC 9.6.6" },
    ],
    defaultVersion: 6,
  },
  {
    id: "elixir",
    label: "Elixir",
    ext: "ex",
    fence: "elixir",
    comment: "#",
    group: "Functional",
    stdin: true,
    versions: [
      { index: 2, label: "1.6.4" },
      { index: 4, label: "1.12.2" },
      { index: 5, label: "1.15.7" },
      { index: 6, label: "1.19.5" },
    ],
    defaultVersion: 6,
  },
  {
    id: "clojure",
    label: "Clojure",
    ext: "clj",
    fence: "clojure",
    comment: ";",
    group: "Functional",
    stdin: true,
    versions: [
      { index: 1, label: "1.9.0" },
      { index: 3, label: "1.10.3" },
      { index: 4, label: "1.11.1" },
      { index: 5, label: "1.12.4" },
    ],
    defaultVersion: 5,
  },
  {
    id: "julia",
    label: "Julia",
    ext: "jl",
    fence: "julia",
    comment: "#",
    group: "Data",
    stdin: true,
    versions: [
      { index: 0, label: "1.9.3" },
      { index: 1, label: "1.12.4" },
    ],
    defaultVersion: 1,
  },
  {
    id: "dart",
    label: "Dart",
    ext: "dart",
    fence: "dart",
    comment: "//",
    group: "Scripting",
    stdin: true,
    versions: [
      { index: 3, label: "2.5.1" },
      { index: 4, label: "2.14.4" },
      { index: 5, label: "3.0.7" },
    ],
    defaultVersion: 5,
  },
  {
    id: "erlang",
    label: "Erlang",
    ext: "erl",
    fence: "erlang",
    comment: "%",
    group: "Functional",
    stdin: true,
    versions: [
      { index: 0, label: "OTP 22" },
      { index: 1, label: "OTP 24" },
      { index: 2, label: "OTP 26" },
      { index: 3, label: "OTP 28" },
    ],
    defaultVersion: 3,
  },
  {
    id: "ocaml",
    label: "OCaml",
    ext: "ml",
    fence: "ocaml",
    comment: "(*",
    group: "Functional",
    stdin: true,
    versions: [
      { index: 0, label: "4.03.0" },
      { index: 2, label: "4.12.0" },
      { index: 4, label: "5.4.1" },
    ],
    defaultVersion: 4,
  },
  {
    id: "fsharp",
    label: "F#",
    ext: "fs",
    fence: "fsharp",
    comment: "//",
    group: "Functional",
    stdin: true,
    onlineCompiler: "dotnet-fsharp-9",
    versions: [
      { index: 0, label: "4.1" },
      { index: 1, label: "4.5.0" },
      { index: 2, label: "10.2.3" },
      { index: 3, label: "F# 10" },
    ],
    defaultVersion: 3,
  },
  {
    id: "groovy",
    label: "Groovy",
    ext: "groovy",
    fence: "groovy",
    comment: "//",
    group: "JVM",
    stdin: true,
    versions: [
      { index: 1, label: "2.4.12" },
      { index: 3, label: "2.5.8" },
      { index: 4, label: "3.0.9" },
      { index: 5, label: "4.0.15" },
    ],
    defaultVersion: 5,
  },
];

/** Fast lookup used on both sides of the wire. */
const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]));

export function getCodeLanguage(id: string): CodeLanguage | undefined {
  return BY_ID.get(id);
}

/** The language the runner opens on, and the one starter snippets default to. */
export const DEFAULT_CODE_LANGUAGE = "python3";

/**
 * The fallback engine can only run these. A language missing from the list has
 * nowhere to fall back to, which the runner reports rather than guessing.
 */
export function onlineCompilerId(language: CodeLanguage): string | null {
  return language.onlineCompiler ?? null;
}

/**
 * Resolve the version to send, preferring what the user picked and falling back
 * to the language's pinned default. Anything unrecognised collapses to the
 * default so a stale or hand-edited request can never run an arbitrary index.
 */
export function resolveVersion(
  language: CodeLanguage,
  versionIndex?: number,
): CodeVersion {
  const wanted = language.versions.find((v) => v.index === versionIndex);
  return wanted ?? language.versions[language.defaultVersion] ?? language.versions[0];
}

/** Language groups in display order. */
export function codeLanguageGroups(): string[] {
  const seen: string[] = [];
  for (const lang of CODE_LANGUAGES) {
    if (!seen.includes(lang.group)) seen.push(lang.group);
  }
  return seen;
}
