import { describe, expect, test } from "bun:test";

import {
  BROWSE_AI_BASE,
  browseAiConfig,
  browseAiCreateUrl,
  browseAiStatus,
  browseAiTaskBody,
  browseAiTaskId,
  browseAiTaskStatusUrl,
  browseAiText,
  isRobotId,
} from "../browse-ai";

function env(values: Record<string, string>) {
  return (name: string) => values[name];
}

describe("browseAiConfig", () => {
  test("reads the documented key and robot names", () => {
    const config = browseAiConfig(
      env({
        BROWSE_AI_API: "key-123",
        BROWSE_AI_ROBOT_ID: "8f14e45f-ceea-467f-a1b2-3c4d5e6f7a8b",
      }),
    );
    expect(config).toEqual({
      key: "key-123",
      robotId: "8f14e45f-ceea-467f-a1b2-3c4d5e6f7a8b",
    });
  });

  test("accepts the alternate names people type", () => {
    const config = browseAiConfig(
      env({ BROWSE_AI_API_KEY: " key-9 ", BROWSE_AI_ROBOTID: "robot_42" }),
    );
    expect(config).toEqual({ key: "key-9", robotId: "robot_42" });
  });

  test("a key with no robot is not configured", () => {
    expect(browseAiConfig(env({ BROWSE_AI_API: "key-123" }))).toBeNull();
  });

  test("a robot with no key is not configured", () => {
    expect(browseAiConfig(env({ BROWSE_AI_ROBOT_ID: "robot_42" }))).toBeNull();
  });

  test("a pasted URL or a path is rejected rather than sent as an id", () => {
    expect(
      browseAiConfig(env({ BROWSE_AI_API: "k", BROWSE_AI_ROBOT_ID: "https://x/y" })),
    ).toBeNull();
    expect(
      browseAiConfig(env({ BROWSE_AI_API: "k", BROWSE_AI_ROBOT_ID: "abc/def" })),
    ).toBeNull();
  });

  test("isRobotId only allows path-safe ids", () => {
    expect(isRobotId("8f14e45f-ceea-467f-a1b2-3c4d5e6f7a8b")).toBe(true);
    expect(isRobotId("short")).toBe(false);
    expect(isRobotId("has space")).toBe(false);
  });
});

describe("request shapes", () => {
  test("tasks are created on the robot, not on a search endpoint", () => {
    expect(browseAiCreateUrl("robot_42")).toBe(
      `${BROWSE_AI_BASE}/robots/robot_42/tasks`,
    );
    expect(browseAiTaskBody("https://example.com/page")).toEqual({
      inputParameters: { originUrl: "https://example.com/page" },
    });
  });

  test("a task is polled by id under the same robot", () => {
    expect(browseAiTaskStatusUrl("robot_42", "task_7")).toBe(
      `${BROWSE_AI_BASE}/robots/robot_42/tasks/task_7`,
    );
  });
});

describe("browseAiStatus", () => {
  test("maps the statuses the API actually returns", () => {
    expect(browseAiStatus({ status: "successful" })).toBe("successful");
    expect(browseAiStatus({ status: "inProgress" })).toBe("inProgress");
    expect(browseAiStatus({ status: "failed" })).toBe("failed");
  });

  test("an unknown or missing status is not read as success", () => {
    expect(browseAiStatus({ status: "weird" })).toBe("unknown");
    expect(browseAiStatus(null)).toBe("unknown");
  });
});

describe("browseAiTaskId", () => {
  test("finds the id at the top level or under result", () => {
    expect(browseAiTaskId({ id: "t1" })).toBe("t1");
    expect(browseAiTaskId({ result: { id: "t2" } })).toBe("t2");
    expect(browseAiTaskId({ status: "queued" })).toBeNull();
  });
});

describe("browseAiText", () => {
  const payload = {
    status: "successful",
    result: {
      capturedTexts: {
        title: "Goku — newest form",
        description: "Silver hair, silver eyes, pale blue aura.",
      },
      capturedLists: {
        images: [{ caption: "Ultra Instinct", url: "https://example.com/a.png" }],
      },
    },
  };

  test("keeps captured strings in order and drops URLs", () => {
    const text = browseAiText(payload);
    expect(text.split("\n")).toEqual([
      "Goku — newest form",
      "Silver hair, silver eyes, pale blue aura.",
      "Ultra Instinct",
    ]);
    expect(text).not.toContain("http");
  });

  test("collapses whitespace and removes duplicates", () => {
    const text = browseAiText({
      result: { capturedTexts: { a: "same   text", b: "same text" } },
    });
    expect(text).toBe("same text");
  });

  test("caps the output so one long page cannot flood the prompt", () => {
    const text = browseAiText(
      { result: { capturedTexts: { body: "x".repeat(5000) } } },
      120,
    );
    expect(text.length).toBe(120);
  });

  test("an empty result reads as no text, not as a thrown error", () => {
    expect(browseAiText({ status: "successful", result: {} })).toBe("");
    expect(browseAiText({ status: "inProgress" })).toBe("");
    expect(browseAiText(null)).toBe("");
  });
});
