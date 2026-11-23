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
 * A connected machine asking for work.
 *
 * The worker in the notebook calls this every few seconds. Claiming a job and
 * recording the heartbeat are the same mutation on purpose: a machine that is
 * fetching work is by definition alive, and a liveness signal that arrived by a
 * separate request could be a second behind the claim it is meant to justify.
 *
 * The artifact URL is built here rather than stored with the job, because it is
 * this deployment's own origin and there is no reason to keep a copy of it in
 * the database.
 */
http.route({
  path: "/machine/next",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = (req.headers.get("x-jarvis-token") ?? "").trim();
    if (!/^[0-9a-f]{48}$/.test(token)) {
      return new Response("bad token", { status: 400 });
    }

    let body: { version?: unknown; platform?: unknown } = {};
    try {
      body = (await req.json()) as typeof body;
    } catch {
      // The body is only there to describe the machine; a poll without one is
      // still a valid poll.
      body = {};
    }

    const claimed = await ctx.runMutation(internal.machines.claim, {
      token,
      version: typeof body.version === "string" ? body.version : undefined,
      platform: typeof body.platform === "string" ? body.platform : undefined,
    });
    if (!claimed.ok) return new Response("unknown machine", { status: 403 });
    if (!claimed.job) return json({ ok: true, job: null });

    const site = process.env.CONVEX_SITE_URL?.trim();
    return json({
      ok: true,
      job: {
        ...claimed.job,
        // No token means the run does not collect files, so there is nothing
        // for the worker to upload to and saying so is clearer than a URL it
        // would be refused at.
        artifactUrl:
          claimed.job.artifactToken && site ? `${site}/artifact` : null,
      },
    });
  }),
});

/**
 * The worker's report on a job it ran.
 *
 * Everything about this call is untrusted: it arrives from a notebook that is
 * running code on someone's behalf, so the only thing it can be allowed to do
 * is finish a job that belongs to the machine its token names. Files do not
 * come through here — they were already uploaded to `/artifact` while the
 * program ran, which is the only path that survives a forty kilobyte deck.
 */
http.route({
  path: "/machine/result",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = (req.headers.get("x-jarvis-token") ?? "").trim();
    if (!/^[0-9a-f]{48}$/.test(token)) {
      return new Response("bad token", { status: 400 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response("unreadable body", { status: 400 });
    }

    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) return new Response("missing job", { status: 400 });

    const accepted = await ctx.runMutation(internal.machines.finish, {
      token,
      jobId,
      output: typeof body.output === "string" ? body.output : "",
      error: typeof body.error === "string" ? body.error : "",
      failed: body.failed === true,
      timedOut: body.timedOut === true,
      exitCode: typeof body.exitCode === "number" ? Math.trunc(body.exitCode) : 0,
      ms: typeof body.ms === "number" ? Math.trunc(body.ms) : 0,
    });
    if (!accepted) return new Response("refused", { status: 409 });

    return json({ ok: true });
  }),
});

/** A JSON reply that no intermediary is allowed to remember. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

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

/**
 * ManyChat External Request → Jarvis.
 *
 * A ManyChat automation calls this with the contact's message and gets one
 * reply back. There is no Convex session behind the call, so the only
 * credential is a bearer secret shared with the automation: dedicated
 * MANYCHAT_WEBHOOK_SECRET when set, otherwise the already-configured
 * MANYCHAT_AI_API_KEY so the channel can be wired without another secret.
 *
 * ManyChat's External Request times out after 10 seconds, which is why the
 * reply uses the latency-weighted engine plan. The body is deliberately plain
 * text in the answer: it is going straight into a messaging app.
 */
http.route({
  path: "/manychat/answer",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = (
      process.env.MANYCHAT_WEBHOOK_SECRET ??
      process.env.MANYCHAT_AI_API_KEY ??
      ""
    ).trim();
    if (!secret) {
      return json(
        { error: "MANYCHAT_WEBHOOK_SECRET is not configured." },
        503,
      );
    }

    const authorization = (req.headers.get("authorization") ?? "").trim();
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (token !== secret) {
      return json({ error: "unauthorized" }, 401);
    }

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await req.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    const candidate =
      typeof body.message === "string"
        ? body.message
        : typeof body.text === "string"
          ? body.text
          : "";
    const message = candidate.trim().slice(0, 6_000);
    if (!message) {
      return json({ error: "message is required" }, 400);
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history = rawHistory
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const turn = item as Record<string, unknown>;
        if (turn.role !== "user" && turn.role !== "assistant") return [];
        if (typeof turn.content !== "string") return [];
        return [{ role: turn.role, content: turn.content.slice(0, 4_000) }];
      })
      .slice(-8);

    const contactCandidate =
      typeof body.contactId === "string"
        ? body.contactId
        : typeof body.contact_id === "string"
          ? body.contact_id
          : typeof body.userId === "string"
            ? body.userId
            : typeof body.user_id === "string"
              ? body.user_id
              : "";
    const contactId = contactCandidate
      .trim()
      .replace(/[^A-Za-z0-9:_-]/g, "")
      .slice(0, 80);

    try {
      const result = await ctx.runAction(internal.ai.answerForChannel, {
        message,
        history,
        ...(contactId ? { contactId } : {}),
      });
      return json({ ok: true, reply: result.reply, engine: result.engine });
    } catch {
      return json(
        { ok: false, error: "Jarvis could not answer that just now." },
        502,
      );
    }
  }),
});

/**
 * Twilio WhatsApp webhook, including the free Sandbox sender.
 *
 * Twilio posts form-encoded fields (Body, From, WaId) to this URL from the
 * number configured in the Twilio console. Returning TwiML is enough to send
 * the reply from that same number — no Account SID or Auth Token is needed in
 * this deployment, so the free Sandbox works without another API client.
 *
 * The shared secret is a query parameter because Twilio's inbound webhook
 * screen does not support custom headers. A dedicated TWILIO_WEBHOOK_SECRET is
 * preferred; the ManyChat secret is accepted as a fallback so one secret can
 * cover both channels during setup.
 */
http.route({
  path: "/twilio/whatsapp",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = (
      process.env.TWILIO_WEBHOOK_SECRET ??
      process.env.MANYCHAT_WEBHOOK_SECRET ??
      process.env.MANYCHAT_AI_API_KEY ??
      ""
    ).trim();
    if (!secret) {
      return twiml(
        "<Response><Message>Twilio is not configured yet.</Message></Response>",
        503,
      );
    }

    const provided = new URL(req.url).searchParams.get("key") ?? "";
    if (provided !== secret) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = new URLSearchParams(await req.text());
    const message = (body.get("Body") ?? "").trim().slice(0, 6_000);
    if (!message) return twiml("<Response/>");

    // WaId is the plain international number; From keeps the whatsapp: prefix.
    const rawContact = body.get("WaId") ?? body.get("From") ?? "";
    const contactId = rawContact
      .replace(/^whatsapp:/i, "")
      .replace(/[^A-Za-z0-9:_-]/g, "")
      .slice(0, 80);

    try {
      const result = await ctx.runAction(internal.ai.answerForChannel, {
        message,
        ...(contactId ? { contactId: `twilio:${contactId}` } : {}),
      });
      // TwiML bodies are safer below the WhatsApp text ceiling; the AI action
      // already caps its own answer, but 1500 leaves room for XML wrapping.
      return twiml(
        `<Response><Message>${xmlEscape(result.reply.slice(0, 1_500))}</Message></Response>`,
      );
    } catch {
      return twiml(
        "<Response><Message>Jarvis could not answer that just now.</Message></Response>",
      );
    }
  }),
});

function twiml(xml: string, status = 200): Response {
  return new Response(xml, {
    status,
    headers: {
      "content-type": "text/xml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** XML text for a TwiML message; control characters would make it invalid. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

export default http;
