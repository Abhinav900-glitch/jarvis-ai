// ---------------------------------------------------------------------------
// The zip reader has no library to lean on, so it gets the most literal test
// there is: archives are assembled byte-by-byte here and read back. A zip the
// builder makes is not necessarily a zip a real tool made — but the format is
// the format, and if these fields drift the parser stops finding manifests.
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import {
  classifyManifest,
  inspectZip,
  readZipEntries,
  readZipText,
  type ZipEntry,
} from "../zip-inspect";

const enc = new TextEncoder();

const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255]);
const u32 = (n: number) =>
  new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface TestFile {
  name: string;
  content: string;
  method?: 0 | 8;
}

/** Assemble a real zip: local headers + data, central directory, EOCD. */
async function buildZip(files: TestFile[]): Promise<ArrayBuffer> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const raw = enc.encode(file.content);
    const method = file.method ?? 0;
    const body = method === 8 ? await deflateRaw(raw) : raw;

    const local = cat(
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(0), // crc — the reader does not verify it
      u32(body.length),
      u32(raw.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      body,
    );
    locals.push(local);

    centrals.push(
      cat(
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(method),
        u16(0),
        u16(0),
        u32(0),
        u32(body.length),
        u32(raw.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ),
    );

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = cat(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  );    const all = cat(...locals, ...centrals, eocd);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

const HAS_DEFLATE =
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined";

describe("readZipEntries", () => {
  test("lists files with their sizes and methods", async () => {
    const buffer = await buildZip([
      { name: "hello.txt", content: "hi there" },
      { name: "dir/inner.json", content: "{}" },
    ]);
    const entries = readZipEntries(buffer);

    expect(entries.map((e) => e.name)).toEqual(["hello.txt", "dir/inner.json"]);
    expect(entries[0].uncompressedSize).toBe(8);
    expect(entries[0].method).toBe(0);
    expect(entries[1].uncompressedSize).toBe(2);
  });

  test("throws a readable error for a non-zip", () => {
    const notAZip = enc.encode("this is definitely not a zip file at all!!").buffer;
    expect(() => readZipEntries(notAZip)).toThrow(/does not look like a zip/);
  });

  test("throws on a file too small to hold an index", () => {
    expect(() => readZipEntries(new ArrayBuffer(4))).toThrow(/too small/);
  });
});

describe("readZipText", () => {
  test("returns stored entry contents", async () => {
    const buffer = await buildZip([{ name: "a.txt", content: "plain text" }]);
    const [entry] = readZipEntries(buffer);
    expect(await readZipText(buffer, entry)).toBe("plain text");
  });

  test.skipIf(!HAS_DEFLATE)("inflates deflate-compressed entries", async () => {
    const content = JSON.stringify({ name: "packed", value: 42 });
    const buffer = await buildZip([
      { name: "packed.json", content, method: 8 },
    ]);
    const [entry] = readZipEntries(buffer);
    expect(entry.method).toBe(8);
    expect(await readZipText(buffer, entry)).toBe(content);
  });

  test("refuses entries larger than the caller allows", async () => {
    const buffer = await buildZip([{ name: "big.txt", content: "0123456789" }]);
    const [entry] = readZipEntries(buffer);
    // 5 < uncompressedSize (10) ⇒ the reader declines to inflate.
    expect(readZipText(buffer, entry, 5)).toBeNull();
    // 10 >= uncompressedSize (10) ⇒ it reads normally.
    expect(await readZipText(buffer, entry, 10)).toBe("0123456789");
  });
});

describe("classifyManifest", () => {
  test("names a plugin from its manifest", () => {
    const found = classifyManifest(
      "my-plugin/.claude-plugin/plugin.json",
      { name: "my-plugin", version: "1.2.0", description: "Does a thing" },
    );
    expect(found).toEqual({
      path: "my-plugin/.claude-plugin/plugin.json",
      kind: "plugin",
      name: "my-plugin",
      version: "1.2.0",
      description: "Does a thing",
    });
  });

  test("falls back to the folder when plugin.json omits a name", () => {
    const found = classifyManifest("cool-thing/.claude-plugin/plugin.json", {});
    expect(found?.name).toBe("cool-thing");
  });

  test("reads MCP servers from an .mcp.json", () => {
    const found = classifyManifest(
      "bundle/.mcp.json",
      { mcpServers: { weather: { command: "npx weather-mcp" } } },
    );
    expect(found?.kind).toBe("mcp");
    expect(found?.name).toBe("weather");
  });

  test("ignores unrelated JSON and files", () => {
    expect(classifyManifest("package.json", { name: "x" })).toBeNull();
    expect(classifyManifest("plugin.json", "a string")).toBeNull();
    expect(classifyManifest("notes.json", { name: "y" })).toBeNull();
  });
});

describe("inspectZip", () => {
  test("finds a plugin manifest inside the archive", async () => {
    const buffer = await buildZip([
      {
        name: "demo/.claude-plugin/plugin.json",
        content: JSON.stringify({ name: "demo", version: "0.1.0" }),
      },
      { name: "demo/README.md", content: "# demo" },
      { name: "demo/skills/demo/SKILL.md", content: "---\nname: demo\n---" },
    ]);

    const result = await inspectZip(buffer);
    expect(result.entries).toHaveLength(3);
    expect(result.manifests).toHaveLength(1);
    expect(result.manifests[0].name).toBe("demo");
    expect(result.manifests[0].kind).toBe("plugin");
    expect(result.manifests[0].version).toBe("0.1.0");
  });

  test.skipIf(!HAS_DEFLATE)(
    "reads manifests stored with deflate",
    async () => {
      const buffer = await buildZip([
        {
          name: "packed/.claude-plugin/plugin.json",
          content: JSON.stringify({ name: "packed", description: "zipped" }),
          method: 8,
        },
      ]);
      const result = await inspectZip(buffer);
      expect(result.manifests[0]?.name).toBe("packed");
    },
  );

  test("skips manifests that are not valid JSON", async () => {
    const buffer = await buildZip([
      { name: "broken/plugin.json", content: "{not json" },
      { name: "fine/plugin.json", content: JSON.stringify({ name: "fine" }) },
    ]);
    const result = await inspectZip(buffer);
    expect(result.manifests.map((m) => m.name)).toEqual(["fine"]);
  });

  test("reports a plugin file list", async () => {
    const buffer = await buildZip([
      { name: "a.txt", content: "1" },
      { name: "nested/b.txt", content: "2" },
    ]);
    const result = await inspectZip(buffer);
    expect(result.entries).toEqual(["a.txt", "nested/b.txt"]);
    expect(result.manifests).toEqual([]);
  });
});
