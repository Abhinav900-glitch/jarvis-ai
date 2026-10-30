// ---------------------------------------------------------------------------
// The contract shared by the agent's action and store modules.
//
// Pure — no Convex imports — so the `"use node"` action file and the
// Convex-runtime store file can both read it, and the UI can import the gate
// legend without dragging a server module along.
//
// It exists as its own file because the gate is the whole point of the feature
// and it must be one list. If the rules were duplicated between "should I ask"
// and "why did I ask", the two would drift and the UI would start lying.
// ---------------------------------------------------------------------------

import { v } from "convex/values";

export const runStatus = v.union(
  v.literal("planning"),
  v.literal("running"),
  v.literal("awaiting_user"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const stepStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("needs_decision"),
);

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Steps that are explicitly about *preparing* rather than *doing*.
 *
 * Checked first, and it wins over everything below. Without it the send/pay/
 * delete rules would fire on "draft the email to the client", which is the
 * single most common way a cautious agent becomes a useless one: it asks
 * permission to think.
 */
const PREPARING =
  /\b(draft|outline|proposal|propose|plan|sketch|spec|walk me through|explain|compare|review|analy[sz]e|summari[sz]e|research|investigate|options|without (sending|publishing|deleting|posting)|dry run|preview|what would)\b/i;

export interface GateRule {
  re: RegExp;
  /** Shown to the user verbatim, so the pause is self-explaining. */
  reason: string;
}

/**
 * Narrow on purpose. Each rule names a class of action where being wrong is
 * expensive and undo is impossible — not everything scary-sounding.
 */
export const GATE_RULES: GateRule[] = [
  {
    re: /\b(delete|remove|erase|wipe|purge|truncate|destroy|revoke|drop (the )?(table|collection|database)|rm\s+-rf)\b/i,
    reason: "cannot be undone",
  },
  {
    re: /\b(buy|purchase|pay|checkout|subscribe|billing|invoice|wire|transfer|upgrade to the paid)\b/i,
    reason: "spends money",
  },
  {
    re: /\b(api[ _-]?keys?|password|secret|credential|access token|sudo|grant|permission|api[ _-]?access)\b/i,
    reason: "puts a credential or permission in play",
  },
  {
    re: /\b(deploy|publish|ship to prod|go live|release to|force[- ]push|merge to main|rewrite history|post (this|it|them)|send (this|it|them|the|an?)|email (this|it|them|the|an?)|upload)\b/i,
    reason: "goes outward and cannot be recalled",
  },
  {
    re: /\b(migrat|backfill|bulk (update|delete|send)|at scale|every user|all users|for all)\b/i,
    reason: "affects more than this task",
  },
  {
    re: /\b(legal|contract|medical|diagnos|tax return|lawyer|attorney|prescrib)\b/i,
    reason: "someone would act on this professionally",
  },
];

/**
 * Why this step has to stop for a human, or null if it can proceed.
 *
 * Returns the rule that fired, not a boolean, because "why was I asked?" is the
 * question a person actually has when an agent interrupts them.
 */
export function gateFor(text: string): string | null {
  if (PREPARING.test(text)) return null;
  for (const rule of GATE_RULES) {
    if (rule.re.test(text)) return rule.reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/**
 * File changes one run may apply before it must stop and report.
 *
 * `auto` writes without asking, so the only thing standing between a stray
 * prompt and a rewritten workspace is a limit. Forty is far past any honest
 * plan — the planner caps a plan at six steps — while still small enough that
 * a loop going wrong cannot spend a day's worth of requests or bury the
 * Undo list before the user notices.
 *
 * Lives here rather than in the exec module so the panel can show the counter
 * next to the mode switch: a budget nobody can see is not a budget.
 */
export const AUTO_WRITE_BUDGET = 40;

/**
 * Undo points kept per workspace.
 *
 * Each one stores a file's full previous contents, so this is both the storage
 * ceiling and the length of the rewind history. The panel shows eight at a
 * time; sixty is a generous scroll-back without letting the table grow
 * without bound.
 */
export const CHECKPOINT_KEEP = 60;
