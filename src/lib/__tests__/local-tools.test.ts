import { describe, expect, test } from "bun:test";
import { LOCAL_TOOLS, runLocalTool } from "../local-tools";

const body = async (name: string, args: string): Promise<string> => {
  const outcome = await runLocalTool(name, args);
  if (!outcome || "error" in outcome) {
    throw new Error(`expected a result, got ${JSON.stringify(outcome)}`);
  }
  return outcome.body;
};

const error = async (name: string, args: string): Promise<string> => {
  const outcome = await runLocalTool(name, args);
  if (!outcome || !("error" in outcome)) {
    throw new Error(`expected an error, got ${JSON.stringify(outcome)}`);
  }
  return outcome.error;
};

describe("convert", () => {
  test("converts within a dimension", async () => {
    expect(await body("convert", "10 km to mi")).toContain("6.2137 mi");
    expect(await body("convert", "1 gb to mib")).toContain("953.6743 mib");
    expect(await body("convert", "100 km/h to mph")).toContain("62.1371 mph");
  });

  test("handles temperature as an affine scale, not a factor", async () => {
    expect(await body("convert", "100 c to f")).toContain("212 F");
    expect(await body("convert", "32 f to c")).toContain("0 C");
  });

  test("refuses to convert across dimensions", async () => {
    expect(await error("convert", "10 km to kg")).toContain("do not convert");
    expect(await error("convert", "10 zork to mi")).toContain("zork");
  });

  test("asks for the right shape when it cannot parse", async () => {
    expect(await error("convert", "10km")).toContain("10 km to mi");
  });
});

describe("json", () => {
  test("pretty-prints valid JSON", async () => {
    const text = await body("json", '{"b":1,"a":[1,2]}');
    expect(text).toContain('"b": 1');
    expect(text).toContain("Valid JSON");
  });

  test("reports a parse error instead of throwing", async () => {
    expect(await error("json", "{oops}")).toMatch(/JSON|Expected|property/i);
  });
});

describe("base64", () => {
  test("round-trips ascii and unicode", async () => {
    expect(await body("base64", "hello")).toBe("aGVsbG8=");
    expect(await body("base64", "aGVsbG8=")).toBe("hello");
    const encoded = await body("base64", "héllo ✓");
    expect(await body("base64", encoded)).toBe("héllo ✓");
  });
});

describe("hash", () => {
  test("matches the known SHA-256 of hello", async () => {
    const text = await body("hash", "hello");
    expect(text).toContain(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("uuid", () => {
  test("generates the requested number of v4 ids", async () => {
    const ids = (await body("uuid", "3")).split("\n");
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test("clamps to a sane count", async () => {
    expect((await body("uuid", "999")).split("\n")).toHaveLength(20);
    expect((await body("uuid", "")).split("\n")).toHaveLength(1);
  });
});

describe("ts", () => {
  test("reads unix seconds", async () => {
    const text = await body("ts", "0");
    expect(text).toContain("1970-01-01T00:00:00.000Z");
    expect(text).toContain("Unix (s)   0");
  });

  test("reads an ISO date", async () => {
    const text = await body("ts", "2026-11-05T12:00:00Z");
    expect(text).toContain("Unix (ms)  1793880000000");
  });

  test("rejects nonsense", async () => {
    expect(await error("ts", "not a date")).toContain("unix timestamp");
  });
});

describe("color", () => {
  test("expands hex into every notation", async () => {
    const text = await body("color", "#2f6feb");
    expect(text).toContain("HEX   #2f6feb");
    expect(text).toContain("RGB   rgb(47 111 235)");
    expect(text).toContain("HSL   hsl(220 82% 55%)");
  });

  test("expands short hex and rgb()", async () => {
    expect(await body("color", "#fff")).toContain("RGB   rgb(255 255 255)");
    expect(await body("color", "rgb(0, 0, 0)")).toContain("HEX   #000000");
  });

  test("black on black fails contrast", async () => {
    expect(await body("color", "#000000")).toContain("On white  21:1  AAA");
  });
});

describe("diff", () => {
  test("counts and marks added and removed lines", async () => {
    const text = await body("diff", "a\nb\nc\n---\na\nB\nc");
    expect(text).toContain("1 added, 1 removed");
    expect(text).toContain("- b");
    expect(text).toContain("+ B");
  });

  test("explains the separator when it is missing", async () => {
    expect(await error("diff", "only one version")).toContain("---");
  });
});

describe("case", () => {
  test("converts an arbitrary phrase into every casing", async () => {
    const text = await body("case", "user profile ID");
    expect(text).toContain("camel        userProfileId");
    expect(text).toContain("snake        user_profile_id");
    expect(text).toContain("kebab        user-profile-id");
    expect(text).toContain("CONSTANT     USER_PROFILE_ID");
    expect(text).toContain("Title Case   User Profile Id");
  });
});

describe("password", () => {
  test("honours the requested length and says where it came from", async () => {
    const text = await body("password", "24");
    const password = text.split("\n")[0];
    expect(password).toHaveLength(24);
    expect(text).toContain("never sent anywhere");
  });

  test("clamps short requests up to the minimum", async () => {
    expect((await body("password", "1")).split("\n")[0]).toHaveLength(8);
  });
});

describe("count", () => {
  test("counts words, sentences and reading time", async () => {
    const text = await body("count", "One two three. Four five six.");
    expect(text).toContain("6 words");
    expect(text).toContain("2 sentences");
    expect(text).toContain("to read");
  });

  test("asks for text when there is none", async () => {
    expect(await error("count", "")).toContain("Paste some text");
  });
});

describe("lorem", () => {
  test("produces the requested number of paragraphs", async () => {
    expect((await body("lorem", "2")).split("\n\n")).toHaveLength(2);
    expect((await body("lorem", "")).split("\n\n")).toHaveLength(3);
  });
});

describe("registry", () => {
  test("every registered tool runs by its own name", async () => {
    for (const name of Object.keys(LOCAL_TOOLS)) {
      const outcome = await runLocalTool(name, "");
      expect(outcome).not.toBeNull();
    }
  });

  test("an unknown name is not a tool", async () => {
    expect(await runLocalTool("definitely-not-a-tool", "x")).toBeNull();
  });
});
