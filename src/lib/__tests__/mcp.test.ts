import { describe, expect, test } from "bun:test";
import { mcpToolToSpec, sanitizeMcpToolName } from "../mcp";

describe("sanitizeMcpToolName", () => {
  test("keeps a already-valid name under its prefix", () => {
    expect(sanitizeMcpToolName("canva", "create_design")).toBe(
      "canva__create_design",
    );
  });

  test("replaces characters providers reject with underscores", () => {
    expect(sanitizeMcpToolName("canva", "create design")).toBe(
      "canva__create_design",
    );
    expect(sanitizeMcpToolName("mcp", "upload/asset")).toBe(
      "mcp__upload_asset",
    );
    expect(sanitizeMcpToolName("mcp", "weird.name!")).toBe("mcp__weird_name_");
  });

  test("truncates to the 64-character provider limit", () => {
    const name = sanitizeMcpToolName("canva", "x".repeat(200));
    expect(name.length).toBe(64);
    expect(name.startsWith("canva__")).toBe(true);
  });

  test("produces only characters inside [a-zA-Z0-9_-]", () => {
    const name = sanitizeMcpToolName("srv", "a b/c.d+e#f");
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("mcpToolToSpec", () => {
  test("prefixes the tool name and passes the schema through", () => {
    const spec = mcpToolToSpec(
      {
        name: "create-design",
        description: "Create a new design.",
        inputSchema: { type: "object", properties: { title: { type: "string" } } },
      },
      "canva",
    );
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("canva__create-design");
    expect(spec.function.description).toBe("Create a new design.");
    expect(spec.function.parameters).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  test("defaults the description when the server omits one", () => {
    const spec = mcpToolToSpec({ name: "search" }, "mcp");
    expect(spec.function.description).toContain("search");
  });

  test("adds a missing object type to the schema", () => {
    const spec = mcpToolToSpec(
      { name: "t", inputSchema: { properties: {} } },
      "mcp",
    );
    expect(spec.function.parameters).toEqual({ type: "object", properties: {} });
  });

  test("falls back to an empty object schema when none is given", () => {
    expect(mcpToolToSpec({ name: "t" }, "mcp").function.parameters).toEqual({
      type: "object",
      properties: {},
    });
    expect(
      mcpToolToSpec({ name: "t", inputSchema: undefined }, "mcp").function
        .parameters,
    ).toEqual({ type: "object", properties: {} });
  });
});
