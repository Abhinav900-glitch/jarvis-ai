/**
 * Conversation export — turns the current transcript into something the user
 * can keep: a Markdown file, a plain-text transcript, a self-contained HTML
 * page, or raw JSON for re-importing elsewhere.
 */

export interface ExportMessage {
  role: string;
  content: string;
  model?: string;
  createdAt?: number;
  imageUrl?: string;
  images?: { url: string; publicId?: string }[];
  fileUrl?: string;
  fileName?: string;
  sources?: { title: string; url: string; domain?: string }[];
}

export interface ExportSession {
  title?: string;
  createdAt?: number;
  messages: ExportMessage[];
}

export type ExportFormat = "markdown" | "text" | "html" | "json";

const escapeHtml = (raw: string) =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const stamp = (ms?: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const safeFilename = (title: string) => {
  const slug = (title || "jarvis-chat")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `jarvis-${slug || "chat"}-${new Date().toISOString().slice(0, 10)}`;
};

/** Markdown — the default, and the one that survives every note app. */
export function toMarkdown(session: ExportSession): string {
  const title = session.title?.trim() || "Jarvis chat";
  const head = [
    `# ${title}`,
    "",
    `_Exported ${stamp(Date.now())}_`,
  ];
  if (session.createdAt) head.push(`_Started ${stamp(session.createdAt)}_`);
  head.push("");

  const body = session.messages.map((m) => {
    const who = m.role === "user" ? "**You**" : "**Jarvis**";
    const time = m.createdAt ? ` — _${stamp(m.createdAt)}_` : "";
    const meta = m.model ? ` _(${m.model})_` : "";
    const images =
      m.images && m.images.length > 0
        ? m.images.map((i) => `![attachment](${i.url})`).join("\n")
        : m.imageUrl
          ? `![attachment](${m.imageUrl})`
          : "";
    const file = m.fileUrl
      ? `\n[Attachment: ${m.fileName ?? "file"}](${m.fileUrl})`
      : "";
    const sources =
      m.sources && m.sources.length > 0
        ? `\n\n**Sources**\n${m.sources
            .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
            .join("\n")}`
        : "";
    return `${who}${meta}${time}:\n${
      images ? images + "\n\n" : ""
    }${m.content}${sources}${file}`;
  });

  return [...head, body.join("\n\n---\n\n")].join("\n");
}

/** Plain text — for pasting into anything that refuses markdown. */
export function toPlainText(session: ExportSession): string {
  const title = session.title?.trim() || "Jarvis chat";
  const head = [title, "=".repeat(title.length), `Exported ${stamp(Date.now())}`, ""];
  const body = session.messages.map((m) => {
    const who = m.role === "user" ? "YOU" : "JARVIS";
    const time = m.createdAt ? ` (${stamp(m.createdAt)})` : "";
    return `${who}${time}\n${"-".repeat(who.length + time.length)}\n${m.content}`;
  });
  return [...head, body.join("\n\n")].join("\n");
}

/**
 * A single self-contained HTML file with the transcript rendered — no scripts,
 * no external CSS, so it opens offline and survives being emailed around.
 */
export function toHtml(session: ExportSession): string {
  const title = session.title?.trim() || "Jarvis chat";
  const rows = session.messages
    .map((m) => {
      const user = m.role === "user";
      const imgs =
        m.images && m.images.length > 0
          ? m.images.map((i) => `<img src="${escapeHtml(i.url)}" alt="" />`).join("")
          : m.imageUrl
            ? `<img src="${escapeHtml(m.imageUrl)}" alt="" />`
            : "";
      const sources =
        m.sources && m.sources.length > 0
          ? `<ul class="src">${m.sources
              .map(
                (s) =>
                  `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a></li>`,
              )
              .join("")}</ul>`
          : "";
      return `<article class="${user ? "user" : "bot"}">
  <header><strong>${user ? "You" : "Jarvis"}</strong>${
    m.createdAt ? `<span>${stamp(m.createdAt)}</span>` : ""
  }${m.model ? `<code>${escapeHtml(m.model)}</code>` : ""}</header>
  ${imgs ? `<div class="imgs">${imgs}</div>` : ""}
  <pre>${escapeHtml(m.content)}</pre>
  ${sources}
</article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem 1rem; font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  .meta { color: #888; font-size: 12px; margin-bottom: 2rem; }
  article { border: 1px solid #8883; border-radius: 12px; padding: 1rem 1.1rem; margin-bottom: 1.1rem; }
  article.user { background: #8881; }
  article header { display: flex; align-items: center; gap: .5rem; font-size: 12px; color: #888; margin-bottom: .5rem; }
  article header code { margin-left: auto; opacity: .6; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; }
  .imgs img { max-width: 220px; border-radius: 8px; margin: 0 .5rem .5rem 0; }
  .src { font-size: 13px; color: #888; margin: .6rem 0 0; padding-left: 1.1rem; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="meta">Exported from Jarvis · ${stamp(Date.now())}</p>
${rows}
</main>
</body>
</html>`;
}

export function serialize(session: ExportSession, format: ExportFormat): string {
  switch (format) {
    case "text":
      return toPlainText(session);
    case "html":
      return toHtml(session);
    case "json":
      return JSON.stringify({ ...session, exportedAt: Date.now() }, null, 2);
    default:
      return toMarkdown(session);
  }
}

const MIME: Record<ExportFormat, string> = {
  markdown: "text/markdown",
  text: "text/plain",
  html: "text/html",
  json: "application/json",
};

const EXT: Record<ExportFormat, string> = {
  markdown: "md",
  text: "txt",
  html: "html",
  json: "json",
};

export const EXPORT_FORMATS: {
  id: ExportFormat;
  label: string;
  hint: string;
}[] = [
  { id: "markdown", label: "Markdown", hint: "Tables, code and sources intact" },
  { id: "text", label: "Plain text", hint: "Pastes anywhere" },
  { id: "html", label: "HTML page", hint: "Opens offline, styled" },
  { id: "json", label: "JSON", hint: "Full structured data" },
];

/** Triggers a file download of the rendered conversation. */
export function downloadExport(
  session: ExportSession,
  format: ExportFormat,
): void {
  const blob = new Blob([serialize(session, format)], {
    type: `${MIME[format]};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename(session.title ?? "")}.${EXT[format]}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies the rendered conversation to the clipboard. */
export async function copyExport(
  session: ExportSession,
  format: ExportFormat,
): Promise<void> {
  await navigator.clipboard.writeText(serialize(session, format));
}
