// ---------------------------------------------------------------------------
// Prompts for the optional AI pass.
//
// The blueprint already writes every file offline, so the model is never asked
// to invent the project — only to rewrite one file it can already see, while
// keeping the contract that makes the project compile: same path, same
// exports, same relative imports.
// ---------------------------------------------------------------------------

export const CODE_SYSTEM_PROMPT = [
  "You are a senior engineer finishing one file in an existing project.",
  "You output the complete file, nothing else: no prose, no code fences, no",
  "apologies, no placeholders. Keep every export the file already has — other",
  "files import them by name. Keep relative import paths exactly as they are",
  "unless the file's own body requires changing them. Prefer clear, ordinary",
  "code over cleverness, and stay in the language of the file.",
].join(" ");

/**
 * Models wrap code in fences even when told not to. This unwraps a fenced
 * reply, and keeps the body of an unclosed fence rather than throwing the file
 * away — the checker is the judge of whether it is complete.
 */
export function stripCodeFences(text: string): string {
  const trimmed = (text ?? "").trim();
  const closed = trimmed.match(/^```[a-zA-Z0-9+#-]*\n([\s\S]*?)\n```$/);
  if (closed) return closed[1];
  if (trimmed.startsWith("```")) {
    const firstBreak = trimmed.indexOf("\n");
    if (firstBreak !== -1) return trimmed.slice(firstBreak + 1).replace(/\n?```\s*$/, "");
  }
  return trimmed;
}

export interface FileRewriteRequest {
  project: string;
  stack: string;
  path: string;
  language: string;
  role: string;
  siblings: string[];
  current: string;
  instruction?: string;
}

/**
 * One file, with just enough of the project around it to stay consistent.
 *
 * Sibling paths are given so the model does not invent an import that the
 * project never writes — the checker would reject it, and the template would
 * be kept, which wastes the call.
 */
export function fileRewritePrompt(request: FileRewriteRequest): string {
  const instruction =
    request.instruction?.trim() ||
    "Make this file production-quality: finish the implementation, tighten the types, add the comments a new teammate would want.";

  return [
    `Project: ${request.project} (${request.stack})`,
    `File to rewrite: ${request.path} — ${request.language}, ${request.role}`,
    instruction,
    "Other files in this project (import only from these):\n" +
      request.siblings.slice(0, 60).map((path) => "- " + path).join("\n"),
    "Current version:\n<<<FILE\n" + request.current.slice(0, 6000) + "\nFILE>>>",
    "Return the whole file, starting from its first line. No fences, no explanation.",
  ].join("\n\n");
}
