// ---------------------------------------------------------------------------
// Zip inspection, dependency-free.
//
// Settings → Plugins stores the user's zip as-is in Convex file storage, but
// it has to show what is inside before anyone trusts it: which plugin folders
// and MCP configs the archive holds. That means reading the zip's own index —
// the end-of-central-directory record, the central directory, and (for JSON
// manifests) the entries themselves — with nothing but DataView, so no archive
// library ships to every visitor.
//
// Entry data is only inflated for small files: a manifest is a few KB, and
// decompressing someone's 20 MB asset just to display a name is not on.
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate — the only two methods in practice. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** One manifest found inside the archive, flattened for display. */
export interface DetectedManifest {
  path: string;
  kind: "plugin" | "mcp";
  name: string;
  version?: string;
  description?: string;
}

export interface ZipInspection {
  /** File names (directories dropped), as stored. */
  entries: string[];
  manifests: DetectedManifest[];
}

const END_OF_CENTRAL_DIR = 0x06054b50;
const CENTRAL_DIR_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** Manifests are read only when they unpack under this size. */
const MANIFEST_LIMIT = 256 * 1024;

/**
 * Walk the central directory and return every entry.
 *
 * Throws if the buffer is not a zip — the caller shows that message, so it is
 * written for a person, not a log.
 */
export function readZipEntries(buffer: ArrayBuffer): ZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 22) throw new Error("That file is too small to be a zip.");

  // The end-of-central-directory record is last, followed by a comment of at
  // most 65535 bytes — so scan backwards from the tail for its signature.
  const scanStart = Math.max(0, bytes.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("That does not look like a zip file (no central directory).");
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset >= bytes.length) {
    throw new Error("The zip's index points past the end of the file.");
  }

  const entries: ZipEntry[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > bytes.length) break;
    if (view.getUint32(cursor, true) !== CENTRAL_DIR_ENTRY) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (cursor + 46 + nameLen > bytes.length) break;
    const name = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLen),
    );

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (entryCount > 0 && entries.length === 0) {
    throw new Error("The zip's index could not be read — the file may be corrupt.");
  }
  return entries;
}

/**
 * Inflate one entry as text, or null when it cannot be read (unknown method,
 * out of bounds, larger than the caller asked to handle). Never throws for a
 * merely malformed entry: one bad file must not sink the whole listing.
 */
export async function readZipText(
  buffer: ArrayBuffer,
  entry: ZipEntry,
  maxBytes = MANIFEST_LIMIT,
): Promise<string | null> {
  if (entry.uncompressedSize > maxBytes) return null;

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length) return null;
  if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER) return null;

  const nameLen = view.getUint16(offset + 26, true);
  const extraLen = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) return null;

  const data = bytes.subarray(dataStart, dataEnd);

  if (entry.method === 0) {
    return new TextDecoder().decode(data);
  }
  if (entry.method === 8) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const stream = new Blob([data.slice()]).stream().pipeThrough(
        new DecompressionStream("deflate-raw"),
      );
      const out = await new Response(stream).arrayBuffer();
      return new TextDecoder().decode(out);
    } catch {
      return null;
    }
  }
  return null;
}

const MANIFEST_BASENAMES = new Set(["plugin.json", "mcp.json", ".mcp.json"]);

/**
 * Decide whether a parsed JSON file is a manifest worth showing, and what to
 * call it. An object with `mcpServers` is MCP config by definition; otherwise
 * anything named plugin.json that carries a name (or lives in a folder that
 * has one) is a plugin.
 */
export function classifyManifest(
  path: string,
  parsed: unknown,
): DetectedManifest | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const base = path.split("/").pop() ?? path;
  if (!MANIFEST_BASENAMES.has(base)) return null;
  const obj = parsed as Record<string, unknown>;

  const str = (key: string): string | undefined =>
    typeof obj[key] === "string" && (obj[key] as string).trim() !== ""
      ? (obj[key] as string).trim()
      : undefined;

  if (
    typeof obj.mcpServers === "object" &&
    obj.mcpServers !== null &&
    !Array.isArray(obj.mcpServers)
  ) {
    const servers = Object.keys(obj.mcpServers as object);
    return {
      path,
      kind: "mcp",
      // An .mcp.json rarely names itself; the first server key does the job.
      name: str("name") ?? servers[0] ?? "MCP servers",
      version: str("version"),
      description: str("description"),
    };
  }

  if (base === "plugin.json") {
    const parts = path.split("/");
    parts.pop(); // the file itself
    if (parts[parts.length - 1] === ".claude-plugin") parts.pop();
    const fallback = parts[parts.length - 1];
    return {
      path,
      kind: "plugin",
      name: str("name") ?? fallback ?? "plugin",
      version: str("version"),
      description: str("description"),
    };
  }

  return null;
}

/** Read a zip's file list and the manifests inside it. */
export async function inspectZip(buffer: ArrayBuffer): Promise<ZipInspection> {
  const all = readZipEntries(buffer);
  const entries = all.filter((e) => !e.name.endsWith("/")).map((e) => e.name);

  const manifests: DetectedManifest[] = [];
  for (const entry of all) {
    if (manifests.length >= 10) break;
    if (entry.name.endsWith("/")) continue;
    const base = entry.name.split("/").pop() ?? "";
    if (!MANIFEST_BASENAMES.has(base)) continue;
    if (entry.uncompressedSize > MANIFEST_LIMIT) continue;

    const text = await readZipText(buffer, entry);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const detected = classifyManifest(entry.name, parsed);
    if (detected) manifests.push(detected);
  }

  return { entries, manifests };
}
