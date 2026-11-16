// Tests for chain routing: several engines on one turn.
//
// The thing worth locking down is not the score arithmetic but the properties a
// chain must have to be honest: a stage that cannot answer is never planned, the
// final stage is always the one that writes the answer, a second provider is
// preferred over a second model from the same one, and a chain never pretends to
// exist when only one engine is reachable.
//
// Placement note: outside src/convex because convex.json points
// `"functions": "src/convex/"` and Convex loads every file there as a function
// module — a file exporting `test`/`expect` there fails to deploy.

import { afterEach, describe, expect, test } from "bun:test";
import { ENGINES, PROVIDERS } from "../../convex/engines";
import {
  bestAvailableText,
  CHAIN_DEPTHS,
  chainEligible,
  chainReason,
  DEPTH_SPECS,
  depthFor,
  planChain,
  promptFor,
  rolesFor,
  stagePreview,
  type ChainContext,
  type ChainStageTrace,
} from "../../convex/chain";

const KEY_ENVS = [...new Set(PROVIDERS.flatMap((p) => p.keyEnv))];
const realEnv: Record<string, string | undefined> = {};

function configureAll() {
  for (const key of KEY_ENVS) {
    if (!(key in realEnv)) realEnv[key] = process.env[key];
    process.env[key] = "test-key";
  }
}

/** Leaves only one provider configured, so chains are same-provider only. */
function configureOnly(providerId: string) {
  const keys = PROVIDERS.find((p) => p.id === providerId)?.keyEnv ?? [];
  for (const key of KEY_ENVS) {
    if (!(key in realEnv)) realEnv[key] = process.env[key];
    if (keys.includes(key)) process.env[key] = "test-key";
    else delete process.env[key];
  }
}

function configureNone() {
  for (const key of KEY_ENVS) {
    if (!(key in realEnv)) realEnv[key] = process.env[key];
    delete process.env[key];
  }
}

afterEach(() => {
  for (const key of KEY_ENVS) {
    const value = realEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(realEnv)) delete realEnv[key];
});

describe("chain depth", () => {
  test("unknown values fall back to deep, never to a different chain", () => {
    expect(depthFor("quick")).toBe("quick");
    expect(depthFor("max")).toBe("max");
    expect(depthFor("deep")).toBe("deep");
    expect(depthFor(undefined)).toBe("deep");
    expect(depthFor("giant")).toBe("deep");
    expect(depthFor(3)).toBe("deep");
  });

  test("every depth ends with the stage that writes the answer", () => {
    for (const depth of CHAIN_DEPTHS) {
      const stages = DEPTH_SPECS[depth].stages;
      expect(stages[stages.length - 1]).toBe("synthesize");
      expect(stages[0]).toBe(stages.length > 2 ? "plan" : "draft");
      expect(stagePreview(depth).map((s) => s.role)).toEqual(stages);
    }
  });

  test("a summary skips planning, since it is already a compression", () => {
    expect(rolesFor("deep", "summarize")).toEqual([
      "draft",
      "critique",
      "synthesize",
    ]);
    // Trimming must never leave a single stage, whatever the task.
    for (const depth of CHAIN_DEPTHS) {
      for (const task of ["chat", "code", "summarize", "translate"] as const) {
        expect(rolesFor(depth, task).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test("titles and live voice never chain", () => {
    expect(chainEligible("title")).toBe(false);
    expect(chainEligible("live")).toBe(false);
    expect(chainEligible("chat")).toBe(true);
    expect(chainEligible("reason")).toBe(true);
    expect(chainEligible("code")).toBe(true);
  });
});

describe("planChain", () => {
  test("plans one distinct provider per stage when the keys allow it", () => {
    configureAll();
    const plan = planChain({ task: "reason", depth: "deep" });
    expect(plan.skipped).toBeNull();
    expect(plan.stages.map((s) => s.role)).toEqual([
      "plan",
      "draft",
      "critique",
      "synthesize",
    ]);
    const providers = plan.stages.map((s) => s.provider);
    expect(new Set(providers).size).toBe(providers.length);
    expect(plan.providers).toEqual([...new Set(providers)]);
    expect(plan.reason).toContain("Deep chain");
  });

  test("never plans more than one stage on the same model", () => {
    configureAll();
    for (const depth of CHAIN_DEPTHS) {
      const ids = planChain({ task: "code", depth }).stages.map((s) => s.engine.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test("only plans engines whose key is present", () => {
    configureOnly("groq");
    const plan = planChain({ task: "reason", depth: "deep" });
    expect(plan.skipped).toBeNull();
    // Groq registers three engines, so a four-stage chain reuses one of them
    // rather than reaching a provider with no key.
    expect(plan.stages.length).toBeGreaterThanOrEqual(2);
    for (const stage of plan.stages) expect(stage.provider).toBe("groq");
  });

  test("says so instead of pretending when nothing is configured", () => {
    configureNone();
    const plan = planChain({ task: "chat", depth: "deep" });
    expect(plan.stages).toEqual([]);
    expect(plan.skipped).toContain("No AI provider");
    expect(plan.summary).toBe("");
  });

  test("image turns stay single-engine", () => {
    configureAll();
    const plan = planChain({ task: "vision", depth: "max", hasImages: true });
    expect(plan.stages).toEqual([]);
    expect(plan.skipped).toContain("image");
  });

  test("chat titles stay single-engine", () => {
    configureAll();
    const plan = planChain({ task: "title", depth: "quick" });
    expect(plan.stages).toEqual([]);
    expect(plan.skipped).not.toBeNull();
  });

  test("installed-but-off model plugins are never routed into a chain", () => {
    configureAll();
    const plan = planChain({ task: "chat", depth: "max" });
    for (const stage of plan.stages) {
      const gated = PROVIDERS.find((p) => p.id === stage.provider)?.plugins ?? [];
      expect(gated.some((plugin) => plugin.slug === stage.engine.modelId)).toBe(
        false,
      );
    }
  });

  test("every planned engine is a real registry entry", () => {
    configureAll();
    const plan = planChain({ task: "research", depth: "max" });
    for (const stage of plan.stages) {
      expect(ENGINES.some((engine) => engine.id === stage.engine.id)).toBe(true);
      expect(stage.label.length).toBeGreaterThan(0);
      expect(stage.because.length).toBeGreaterThan(0);
    }
  });
});

describe("stage prompts", () => {
  const context: ChainContext = {
    question: "What does the N+1 query problem look like in Convex?",
    depth: "deep",
    draft: "It is when one query runs per row.",
  };

  test("every stage carries the original task", () => {
    for (const role of DEPTH_SPECS.max.stages) {
      expect(promptFor(role, context)).toContain("N+1 query problem");
    }
  });

  test("the critique is given the draft and told not to rewrite it", () => {
    const prompt = promptFor("critique", context);
    expect(prompt).toContain("It is when one query runs per row.");
    expect(prompt.toLowerCase()).toContain("not to write a better answer");
  });

  test("the final stage refuses to mention the pipeline", () => {
    const prompt = promptFor("synthesize", context);
    expect(prompt).toContain("No mention of drafts, reviewers, stages or models.");
    expect(prompt).toContain("It is when one query runs per row.");
  });

  test("a huge draft is trimmed rather than sent whole", () => {
    const prompt = promptFor("synthesize", {
      ...context,
      draft: "x".repeat(60_000),
    });
    expect(prompt).toContain("trimmed at");
    expect(prompt.length).toBeLessThan(60_000);
  });
});

describe("chain description", () => {
  const plan = planChain({ task: "reason", depth: "quick" });
  const trace: ChainStageTrace[] = [
    {
      role: "draft",
      label: "Draft",
      engineId: "groq/gpt-oss-20b",
      model: "groq/GPT-OSS 20B",
      provider: "groq",
      latencyMs: 900,
      chars: 400,
      plannedEngineId: "googleai/gemini-3.5-flash",
      planned: "Gemini 3.5 Flash",
    },
    {
      role: "synthesize",
      label: "Final",
      engineId: "mistral/ministral-14b",
      model: "mistral/Ministral 14B",
      provider: "mistral",
      latencyMs: 1200,
      chars: 600,
      plannedEngineId: "mistral/ministral-14b",
      planned: "Ministral 14B",
    },
  ];

  test("names the stages that actually ran, with the provider count", () => {
    configureAll();
    const reason = chainReason(plan, trace);
    expect(reason).toContain("Quick chain (2 providers)");
    expect(reason).toContain("Draft groq/GPT-OSS 20B");
    expect(reason).toContain("Final mistral/Ministral 14B");
  });

  test("names the engine a stage fell back from", () => {
    const reason = chainReason(plan, [trace[0]]);
    expect(reason).toContain(
      "Draft Gemini 3.5 Flash → groq/GPT-OSS 20B (planned engine failed)",
    );
  });

  test("reports a skipped stage instead of hiding it", () => {
    const reason = chainReason(plan, trace.slice(0, 1), ["Critique: out of time"]);
    expect(reason).toContain("Critique: out of time");
  });

  test("survives a chain where nothing answered", () => {
    expect(chainReason(plan, [], ["Draft: no key"])).toContain("Draft: no key");
  });
});

describe("fallback text", () => {
  test("prefers the finished answer, then the rewrite, then the draft", () => {
    expect(
      bestAvailableText({
        question: "q",
        depth: "max",
        draft: "d",
        refined: "r",
        synthesized: "s",
      }),
    ).toBe("s");
    expect(
      bestAvailableText({ question: "q", depth: "max", draft: "d", refined: "r" }),
    ).toBe("r");
    expect(bestAvailableText({ question: "q", depth: "max", draft: "d" })).toBe(
      "d",
    );
    expect(bestAvailableText({ question: "q", depth: "max", draft: "  " })).toBeNull();
  });
});
