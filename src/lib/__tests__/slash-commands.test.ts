import { describe, expect, test } from "bun:test";
import { LOCAL_TOOLS } from "../local-tools";
import { PROMPT_TEMPLATES, buildPromptCommand } from "../prompt-templates";
import {
  SLASH_COMMANDS,
  SLASH_GROUP_ORDER,
  matchSlashCommand,
  slashMenuCommands,
} from "../slash-commands";

describe("command table", () => {
  test("names and aliases are unique across every command", () => {
    const seen = new Set<string>();
    for (const command of SLASH_COMMANDS) {
      for (const name of [command.name, ...command.aliases]) {
        expect(seen.has(name)).toBe(false);
        seen.add(name);
      }
    }
  });

  test("every command belongs to a group the menu renders", () => {
    for (const command of SLASH_COMMANDS) {
      expect(SLASH_GROUP_ORDER).toContain(command.group);
    }
  });

  test("every command is documented with an example", () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.summary.length).toBeGreaterThan(10);
      expect(command.example.startsWith("/")).toBe(true);
    }
  });

  test("carries forty workflow and tool commands beyond the core set", () => {
    expect(Object.keys(PROMPT_TEMPLATES)).toHaveLength(28);
    expect(Object.keys(LOCAL_TOOLS)).toHaveLength(12);
    expect(SLASH_COMMANDS.filter((c) => c.buildPrompt)).toHaveLength(28);
    expect(SLASH_COMMANDS.filter((c) => c.group === "Tools")).toHaveLength(12);
  });

  test("commands whose tool is useless without input wait in the composer", () => {
    for (const name of ["convert", "json", "base64", "hash", "count", "color", "diff", "case"]) {
      expect(SLASH_COMMANDS.find((c) => c.name === name)?.needsArg).toBe(true);
    }
    for (const name of ["uuid", "ts", "password", "lorem"]) {
      expect(SLASH_COMMANDS.find((c) => c.name === name)?.needsArg).toBeFalsy();
    }
  });
});

describe("matchSlashCommand", () => {
  test("parses names containing digits", () => {
    expect(matchSlashCommand("/base64 hello")?.command.name).toBe("base64");
    expect(matchSlashCommand("/el5 quantum tunnelling")?.command.name).toBe("el5");
  });

  test("keeps the argument intact", () => {
    const match = matchSlashCommand("/convert 10 km to mi");
    expect(match?.command.name).toBe("convert");
    expect(match?.args).toBe("10 km to mi");
  });

  test("still ignores prose that merely contains a slash", () => {
    expect(matchSlashCommand("use /convert for that")).toBeNull();
    expect(matchSlashCommand("/notacommand")).toBeNull();
  });
});

describe("prompt templates", () => {
  test("every template builds a prompt that carries the argument", () => {
    for (const [name, template] of Object.entries(PROMPT_TEMPLATES)) {
      const prompt = template.build("the quick brown fox");
      expect(prompt.length).toBeGreaterThan(60);
      expect(prompt).toContain("the quick brown fox");
      expect(buildPromptCommand(name, "x")).not.toBeNull();
    }
  });

  test("an empty argument points at the conversation instead of going blank", () => {
    for (const template of Object.values(PROMPT_TEMPLATES)) {
      const prompt = template.build("");
      expect(prompt.length).toBeGreaterThan(60);
      expect(prompt).not.toMatch(/\s{2,}:\s*$/);
      expect(prompt.trimEnd().endsWith(":")).toBe(false);
    }
  });

  test("an unknown template has no prompt", () => {
    expect(buildPromptCommand("definitely-not-a-template", "x")).toBeNull();
  });
});

describe("slashMenuCommands", () => {
  test("a bare slash offers every command", () => {
    expect(slashMenuCommands("/").length).toBe(SLASH_COMMANDS.length);
  });

  test("a prefix ranks the exact command first", () => {
    expect(slashMenuCommands("/conv")[0].name).toBe("convert");
    expect(slashMenuCommands("/wea")[0].name).toBe("weather");
  });

  test("rows are grouped in menu order", () => {
    const groups = slashMenuCommands("/").map((c) => c.group);
    const positions = groups.map((g) => SLASH_GROUP_ORDER.indexOf(g));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("matches aliases", () => {
    expect(slashMenuCommands("/tldr").some((c) => c.name === "recap")).toBe(true);
  });
});
