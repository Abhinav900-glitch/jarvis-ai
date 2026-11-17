// Shared shapes for GenHack's offline project generator.
//
// A blueprint is a plan and its files in one object: the same call that decides
// "this project has features/orders/hooks.ts" also produces that file's text.
// Deterministic on purpose — the writer can be interrupted, restarted, or run
// with no network at all and the next step produces byte-identical content.

export type StackId = "react" | "node" | "python";

export interface GenFile {
  /** POSIX path from the project root. */
  path: string;
  language: string;
  /** One line saying what the file is for, shown in the file tree. */
  role: string;
  content: string;
}

/** A domain noun the project is built around ("orders", "Order"). */
export interface Entity {
  key: string;
  singular: string;
  title: string;
}

export interface BuildContext {
  /** Package/repo name, kebab-case. */
  name: string;
  /** Human title, derived from the brief. */
  title: string;
  brief: string;
  stack: StackId;
  entities: Entity[];
}

export interface Blueprint extends BuildContext {
  files: GenFile[];
  lines: number;
}

export const STACK_LABELS: Record<StackId, string> = {
  react: "React + Vite dashboard",
  node: "Node + TypeScript API",
  python: "Python CLI + package",
};

/** Files each stack writes per domain entity; used to size the entity pool. */
export const PER_ENTITY: Record<StackId, number> = { react: 9, node: 6, python: 9 };

export function pascal(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join("");
}

export function camel(value: string): string {
  const upper = pascal(value);
  return upper ? upper[0].toLowerCase() + upper.slice(1) : upper;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "genhack-app";
}

export function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase())
    .slice(0, 60);
}

export function file(path: string, language: string, role: string, body: string[]): GenFile {
  return { path, language, role, content: body.join("\n") + "\n" };
}
