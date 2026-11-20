"use node";

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  convertedName,
  extensionOf,
  findTarget,
  mimeForTarget,
} from "../lib/convert-formats";

// ---------------------------------------------------------------------------
// File conversion, through ConvertAPI.
//
// One action: take a file the user already has in their cloud, ask the service
// to convert it to a format the app offers, and store the result back in that
// cloud. The interesting decisions are all deliberate:
//
//  * the source file is never re-uploaded by the browser — the action reads the
//    blob from Convex storage, so a 60 MB deck does not travel twice;
//
//  * the target is validated against `conversionTargets`, the same list the
//    panel renders. A client cannot ask for `/convert/docx/to/exe` because that
//    pair was never offered;
//
//  * `StoreFile=false` keeps the result in the response instead of a download
//    URL that expires in three hours. The bytes go into storage immediately,
//    which is what makes the converted file an ordinary cloud file afterwards;
//
//  * the sandbox key is the fallback, not the first choice. A sandbox token is
//    for building against the API without spending credits; falling back to it
//    when the live key is out of credit still gives an answer, and the reply
//    says which token ran.
//
// Failures are reported with the service's own message: "out of conversion
// credits" is something a person can act on, "conversion failed" is not.
// ---------------------------------------------------------------------------

const ENDPOINT = "https://v2.convertapi.com/convert";

/** Mirrors the cloud's own per-file cap; a conversion cannot exceed it either. */
const MAX_BYTES = 64 * 1024 * 1024;

interface ConversionReply {
  Code?: number;
  Message?: string;
  Files?: {
    FileName?: string;
    FileExt?: string;
    FileSize?: number;
    /** Base64 of the result, present when `StoreFile=false`. */
    FileData?: string;
    /** A temporary download URL, present when `StoreFile=true`. */
    Url?: string;
  }[];
}

/**
 * A Blob from bytes the type system calls `ArrayBufferLike`.
 *
 * The buffer of a Uint8Array may be shared, and `BlobPart` only accepts a real
 * ArrayBuffer, so the window is copied out instead of cast away.
 */
function blobOf(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type });
}

interface Credential {
  name: string;
  key: string;
}

/** The live key first, the sandbox token as the fallback. */
function credentials(): Credential[] {
  return [
    { name: "CONVERT_API_KEY", key: process.env.CONVERT_API_KEY?.trim() ?? "" },
    {
      name: "CONVERT_API_SANDBOX_KEY",
      key: process.env.CONVERT_API_SANDBOX_KEY?.trim() ?? "",
    },
  ].filter((entry) => entry.key !== "");
}

/** A message worth showing a person, from an error body that may be JSON. */
function describeFailure(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as ConversionReply;
    message = typeof parsed.Message === "string" ? parsed.Message : "";
  } catch {
    message = body.trim().slice(0, 160);
  }
  if (status === 401 || status === 403) {
    return message
      ? `ConvertAPI refused the key: ${message}`
      : "ConvertAPI refused the key.";
  }
  if (status === 402) return "ConvertAPI is out of conversion credits for this key.";
  if (status === 429) return "ConvertAPI is rate-limiting this key. Try again shortly.";
  if (status === 400) {
    return message
      ? `That conversion is not supported: ${message}`
      : "ConvertAPI does not support that conversion.";
  }
  return message
    ? `ConvertAPI said: ${message}`
    : `ConvertAPI answered ${status}.`;
}

async function convertWith(
  credential: Credential,
  from: string,
  to: string,
  bytes: Uint8Array,
  fileName: string,
  mime: string,
): Promise<{ bytes: Uint8Array; ext: string }> {
  const form = new FormData();
  form.set("File", blobOf(bytes, mime), fileName);
  // Inline result: a URL would expire before the row it belongs to does.
  form.set("StoreFile", "false");

  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.key}`,
      Accept: "application/json",
    },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(describeFailure(res.status, text));

  let reply: ConversionReply | null = null;
  try {
    reply = JSON.parse(text) as ConversionReply;
  } catch {
    // A 200 that is not JSON is a misconfiguration, not a converted file.
    throw new Error("ConvertAPI answered with something that is not a conversion.");
  }

  const file = reply.Files?.[0];
  if (file?.FileData) {
    const decoded = Uint8Array.from(Buffer.from(file.FileData, "base64"));
    if (decoded.byteLength === 0) throw new Error("ConvertAPI returned an empty file.");
    if (decoded.byteLength > MAX_BYTES) {
      throw new Error("The converted file is larger than the 64 MB limit.");
    }
    return { bytes: decoded, ext: (file.FileExt ?? to).toLowerCase() };
  }

  if (file?.Url) {
    // Only reached if the service ignores `StoreFile=false`.
    const download = await fetch(file.Url, { signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new Error(`The converted file could not be downloaded (${download.status}).`);
    const buffer = new Uint8Array(await download.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      throw new Error("The converted file is larger than the 64 MB limit.");
    }
    return { bytes: buffer, ext: (file.FileExt ?? to).toLowerCase() };
  }

  throw new Error("ConvertAPI reported success but returned no file.");
}

/**
 * Convert one cloud file and keep the result.
 *
 * The converted file lands in the same folder as its source and appears in the
 * panel through the normal reactive listing — there is no second kind of file
 * to learn.
 */
export const run = action({
  args: {
    fileId: v.id("cloudFiles"),
    target: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ fileId: string; name: string; url: string | null; engine: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to convert a file.");

    const file = await ctx.runQuery(internal.cloud.loadFile, { fileId: args.fileId, userId });
    if (!file) throw new Error("File not found.");

    const from = extensionOf(file.name);
    if (!from) throw new Error("That file has no extension, so its format is unknown.");
    const target = findTarget(file.name, args.target);
    if (!target) {
      throw new Error(`A ${from.toUpperCase()} file cannot be converted to ${args.target.toUpperCase()} here.`);
    }

    const blob = await ctx.storage.get(file.storageId);
    if (!blob) throw new Error("The stored bytes for that file are gone.");

    const credentialsToTry = credentials();
    if (credentialsToTry.length === 0) {
      throw new Error("Neither CONVERT_API_KEY nor CONVERT_API_SANDBOX_KEY is configured.");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("That file is empty.");
    if (bytes.byteLength > MAX_BYTES) throw new Error("That file is larger than the 64 MB limit.");

    let result: { bytes: Uint8Array; ext: string } | null = null;
    let engine = credentialsToTry[0].name;
    const failures: string[] = [];
    for (const credential of credentialsToTry) {
      try {
        result = await convertWith(
          credential,
          from,
          target.ext,
          bytes,
          file.name,
          file.mime,
        );
        engine = credential.name;
        break;
      } catch (err) {
        // Try the next credential: a spent live key should still answer through
        // the sandbox token rather than failing the button.
        failures.push(`${credential.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }
    if (!result) throw new Error(failures.join(" · "));

    const name = convertedName(file.name, result.ext);
    const storageId = await ctx.storage.store(blobOf(result.bytes, mimeForTarget(result.ext)));

    await ctx.runMutation(internal.cloud.saveConversion, {
      userId,
      storageId,
      name,
      mime: mimeForTarget(result.ext),
      size: result.bytes.byteLength,
      ...(file.folderId ? { folderId: file.folderId } : {}),
    });

    return {
      fileId: args.fileId,
      name,
      url: await ctx.storage.getUrl(storageId),
      engine,
    };
  },
});
