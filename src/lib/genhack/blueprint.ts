// ---------------------------------------------------------------------------
// The planner: brief + stack + size → a complete, deterministic project.
//
// Offline is a requirement, not a fallback. Everything here is plain string
// work, so GenHack can write all ~120 files with no network, no model and no
// keys, and produce the same bytes every time. When a model is available it
// only replaces individual files — the plan itself never depends on one.
// ---------------------------------------------------------------------------

import { checkProject, countLines, type CheckResult } from "./check";
import { nodeFiles } from "./stacks/node";
import { pythonFiles } from "./stacks/python";
import { reactFiles } from "./stacks/react";
import {
  PER_ENTITY,
  slug,
  titleCase,
  type Blueprint,
  type BuildContext,
  type Entity,
  type StackId,
} from "./types";

export const STACK_IDS: StackId[] = ["react", "node", "python"];

/** Scaffolding each stack writes before the first entity folder. */
const SCAFFOLD: Record<StackId, number> = { react: 40, node: 30, python: 25 };

export const MIN_FILES = 40;
export const MAX_FILES = 240;
export const DEFAULT_FILES = 120;

/**
 * Entity names, chosen so the singular is the plural minus its "s" — the
 * generated type names have to look hand-written, and "Order"/"Orders" does.
 */
const ENTITY_POOL = [
  "customers",
  "orders",
  "invoices",
  "payments",
  "shipments",
  "tickets",
  "reports",
  "alerts",
  "teams",
  "files",
  "jobs",
  "audits",
  "vendors",
  "contracts",
  "devices",
  "sessions",
];

export function isStackId(value: string): value is StackId {
  return (STACK_IDS as string[]).includes(value);
}

export function clampTarget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FILES;
  return Math.min(MAX_FILES, Math.max(MIN_FILES, Math.round(value)));
}

function toEntity(key: string): Entity {
  const singular = key.endsWith("s") ? key.slice(0, -1) : key;
  return { key, singular, title: singular[0].toUpperCase() + singular.slice(1) };
}

/**
 * How many entities are needed to land near the requested file count.
 *
 * Four is the floor: the app shell links two features and the docs template
 * lists all of them, so a one-entity project would be a degenerate case.
 */
export function entitiesFor(stack: StackId, targetFiles: number): Entity[] {
  const per = PER_ENTITY[stack];
  const needed = Math.ceil((targetFiles - SCAFFOLD[stack]) / per);
  const count = Math.min(ENTITY_POOL.length, Math.max(4, needed));
  return ENTITY_POOL.slice(0, count).map(toEntity);
}

export function projectTitle(brief: string): string {
  const words = brief.split(" ").slice(0, 6).join(" ");
  return titleCase(words).slice(0, 60) || "GenHack App";
}

export function buildBlueprint(input: {
  brief: string;
  stack?: StackId;
  targetFiles?: number;
}): Blueprint {
  const brief =
    (input.brief ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || "A small operations dashboard";
  const stack: StackId = input.stack && isStackId(input.stack) ? input.stack : "react";
  const targetFiles = clampTarget(input.targetFiles ?? DEFAULT_FILES);
  const entities = entitiesFor(stack, targetFiles);

  const ctx: BuildContext = {
    name: slug(brief),
    title: projectTitle(brief),
    brief,
    stack,
    entities,
  };

  const files =
    stack === "react" ? reactFiles(ctx) : stack === "node" ? nodeFiles(ctx) : pythonFiles(ctx);

  return { ...ctx, files, lines: countLines(files) };
}

/** The blueprint's own quality gate: what the UI shows as "checks". */
export function verifyBlueprint(blueprint: Blueprint): CheckResult {
  return checkProject(blueprint.files.map((entry) => ({ path: entry.path, content: entry.content })));
}
