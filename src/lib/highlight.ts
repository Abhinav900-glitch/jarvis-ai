// ---------------------------------------------------------------------------
// Syntax highlighting for the code runner.
//
// highlight.js ships as a core plus 190 language packs; only the languages
// the runner offers are registered, so the bundle does not pay for the rest.
// `language.fence` already carries the Markdown fence tag for each language —
// it exists so pasted code renders correctly — and hljs resolves the aliases
// those tags use ("js", "html", "sh", "py") itself, so there is no second
// mapping table to keep in sync.
//
// Highlighting is a nicety, never a gate: an unknown fence, an illegal token
// or a failure inside hljs all return null and the caller falls back to plain
// escaped text.
// ---------------------------------------------------------------------------
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES: Record<string, hljs.LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  perl,
  php,
  powershell,
  python,
  r,
  ruby,
  rust,
  scala,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

for (const [name, definition] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, definition);
}

/** HTML-escape text for the plain-text fallback of the editor mirror. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Highlight code for a fence tag, or null when this build has no grammar for
 * it — the caller then shows escaped plain text instead.
 */
export function highlightCode(code: string, fence: string): string | null {
  if (!code) return "";
  if (!hljs.getLanguage(fence)) return null;
  try {
    return hljs.highlight(code, { language: fence, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
