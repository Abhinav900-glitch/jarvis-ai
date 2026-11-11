import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { artifactMimeType } from "../lib/code-run";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Where a sandbox delivers a file it wrote.
 *
 * This exists because a code engine only ever returns stdout, and the engines
 * that can install python-pptx cap that output well below the size of a deck.
 * The program posts the bytes here instead, while it is still running, and the
 * agent picks them up afterwards as download links.
 *
 * No session is involved — a browser is not making this call — so the token is
 * the whole authorisation: minted per run, random, and useless after twenty
 * minutes or once the run's file budget is spent. An unknown token is refused
 * before the body is read.
 *
 * `no-store` and an empty body on purpose: the reply is only the status, and
 * nothing about it should be cached anywhere.
 */
http.route({
  path: "/artifact",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = (req.headers.get("x-jarvis-token") ?? "").trim();
    if (!/^[0-9a-f]{48}$/.test(token)) {
      return new Response("bad token", { status: 400 });
    }

    const grant = await ctx.runQuery(internal.artifacts.lookup, { token });
    if (!grant) {
      return new Response("unknown or expired token", { status: 403 });
    }
    if (grant.files >= grant.maxFiles) {
      return new Response("too many files for this run", { status: 429 });
    }

    const name = decodeName(req.headers.get("x-jarvis-name") ?? "");
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > grant.maxFile) {
      return new Response("file too large", { status: 413 });
    }

    let body: ArrayBuffer;
    try {
      body = await req.arrayBuffer();
    } catch {
      return new Response("unreadable body", { status: 400 });
    }
    if (body.byteLength === 0) return new Response("empty", { status: 400 });
    if (body.byteLength > grant.maxFile) {
      return new Response("file too large", { status: 413 });
    }
    const bytes = new Uint8Array(body.byteLength);
    bytes.set(new Uint8Array(body));

    const mime = artifactMimeType(name);
    const storageId = await ctx.storage.store(new Blob([bytes], { type: mime }));
    const kept = await ctx.runMutation(internal.artifacts.attach, {
      token,
      name,
      mime,
      size: bytes.byteLength,
      storageId,
    });
    if (!kept) {
      // Over budget or a duplicate name: never leave the blob behind.
      await ctx.storage.delete(storageId);
      return new Response("refused", { status: 409 });
    }

    return new Response("", {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  }),
});

/**
 * The filename header back into a safe name.
 *
 * It arrives percent-encoded UTF-8 because a header cannot carry arbitrary
 * bytes, and a filename with a space or an accent is ordinary. Everything that
 * could make a name confusing in a download list — separators, control
 * characters, a leading dot — is removed rather than escaped.
 */
function decodeName(raw: string): string {
  let name = "file";
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  const cleaned = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\.+/, "")
    .slice(-120);
  return cleaned || "file";
}

export default http;
