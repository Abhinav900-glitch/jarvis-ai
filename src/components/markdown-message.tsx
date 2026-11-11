import { useAction } from "convex/react";
import katex from "katex";
import { Check, Copy, Loader2, Play } from "lucide-react";
import { memo, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { DesmosCalculator } from "@/components/desmos-calculator";
import { api } from "@/convex/_generated/api";
import { PROVIDER_LABELS, type CodeProvider, type RunFile } from "@/lib/code-run";
import { linkPageCitations, pageFromFragment } from "@/lib/page-citations";
import {
  extractText,
  normalizeMessageContent,
  sanitizeUrl,
  splitDisplayBlocks,
} from "@/lib/markdown-normalize";

// ---------------------------------------------------------------------------
// Source type (mirror of convex/ai.ts)
// ---------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Code block — language label + copy button around the highlighted code
// ---------------------------------------------------------------------------

/**
 * Fence tag → the runner's language slug.
 *
 * Only languages the runner can actually execute are listed; anything else
 * keeps the copy button and nothing more, because a button that offers to run
 * SQL and then refuses is worse than no button.
 */
const RUNNER_FOR_FENCE: Record<string, string> = {
  py: "python3",
  python: "python3",
  python3: "python3",
  js: "nodejs",
  javascript: "nodejs",
  node: "nodejs",
  nodejs: "nodejs",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  rb: "ruby",
  ruby: "ruby",
  php: "php",
  go: "go",
  golang: "go",
  rust: "rust",
  rs: "rust",
  java: "java",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  cs: "csharp",
  csharp: "csharp",
};

/** What one "Run this" click produced, kept beside the block it belongs to. */
interface Receipt {
  ok: boolean;
  provider: CodeProvider | null;
  output: string;
  error: string;
  failed: boolean;
  timedOut: boolean;
  elapsedMs: number;
  files: RunFile[];
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const runCode = useAction(api.codeRunner.runCode);

  const first = Array.isArray(children) ? children[0] : children;
  const className =
    typeof first === "object" && first !== null && "props" in first
      ? String(
          (first as { props?: { className?: string } }).props?.className ?? "",
        )
      : "";
  const lang = /language-([\w+-]+)/.exec(className)?.[1] ?? "code";
  const raw = extractText(children);

  // Desmos interactive calculator block: ```desmos
  if (lang === "desmos") {
    return <DesmosCalculator source={raw} />;
  }

  const slug = RUNNER_FOR_FENCE[lang.toLowerCase()];

  /**
   * Run the snippet as written.
   *
   * A code answer in plain chat is prose until something executes it, and that
   * is exactly where a confident-looking program fails on a missing package or
   * an off-by-one. Running it here turns "looks right" into an exit code, on
   * the user's own machine when one is connected.
   */
  const execute = async () => {
    if (!slug || running || !raw.trim()) return;
    setRunning(true);
    setRunError(null);
    try {
      const result = await runCode({
        language: slug,
        sourceCode: raw,
        captureFiles: true,
      });
      setReceipt({
        ok: result.ok,
        provider: result.provider,
        output: result.output,
        error: result.error || result.requestError || "",
        failed: result.failed,
        timedOut: result.timedOut,
        elapsedMs: result.elapsedMs,
        files: result.files ?? [],
      });
    } catch (err) {
      setReceipt(null);
      setRunError(err instanceof Error ? err.message : "The run failed.");
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    try {
      // navigator.clipboard requires HTTPS; fall back for insecure contexts
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(raw);
      } else {
        const ta = document.createElement("textarea");
        ta.value = raw;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable — ignore.
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-primary/25 bg-muted/40">
      <div className="flex items-center justify-between border-b border-primary/20 bg-accent/40 px-3 py-1.5">
        <span className="hud-label inline-flex items-center gap-2">
          <span
            className="size-1.5 rounded-full"
            style={{ background: "var(--signal-cyan)" }}
          />
          {lang}
        </span>
        <div className="flex items-center gap-1">
          {slug ? (
            <button
              onClick={() => void execute()}
              disabled={running}
              className="hud-label inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/10 hover:text-foreground disabled:opacity-50"
              aria-label={`Run this ${slug} code`}
              title="Run it here and see the exit code, instead of trusting it"
            >
              {running ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              {running ? "Running" : "Run this"}
            </button>
          ) : null}
          <button
            onClick={copy}
            className="hud-label inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-primary/10 hover:text-foreground"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, var(--signal-cyan), transparent 60%)",
        }}
      />
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        {children}
      </pre>

      {/* The receipt: what ran, where, and what it returned. */}
      {runError ? (
        <p className="border-t border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {runError}
        </p>
      ) : null}

      {receipt ? (
        <div className="border-t border-primary/20 bg-background/60">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-[10px] text-muted-foreground">
            <span className="hud-label">
              {receipt.ok
                ? `ran on ${receipt.provider ? PROVIDER_LABELS[receipt.provider] : "an engine"}`
                : "not run"}
            </span>
            <span className="font-mono">
              {receipt.timedOut
                ? "stopped at the time limit"
                : receipt.ok
                  ? receipt.failed
                    ? "failed"
                    : "exited clean"
                  : ""}
            </span>
            {receipt.elapsedMs ? (
              <span className="ml-auto font-mono tabular-nums">
                {(receipt.elapsedMs / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
          {receipt.output.trim() ? (
            <pre className="max-h-48 overflow-auto border-t border-primary/10 px-3 py-2 font-mono text-[11px] leading-5 text-foreground/90 whitespace-pre-wrap">
              {receipt.output.trim()}
            </pre>
          ) : null}
          {receipt.error.trim() ? (
            <pre className="max-h-40 overflow-auto border-t border-amber-500/25 bg-amber-500/5 px-3 py-2 font-mono text-[11px] leading-5 text-amber-700 dark:text-amber-400 whitespace-pre-wrap">
              {receipt.error.trim()}
            </pre>
          ) : null}
          {receipt.files.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-t border-primary/10 px-3 py-2 text-[11px]">
              {receipt.files.map((file) => (
                <a
                  key={file.url}
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  {file.path}
                  <span className="font-mono text-[10px] opacity-70">
                    {(file.bytes / 1024).toFixed(1)} kB
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer components
// ---------------------------------------------------------------------------

/** Where page citations point: the PDF this conversation is about. */
export interface PdfSource {
  url: string;
  name?: string;
}

/**
 * Components are built per message rather than declared once, because a page
 * citation needs to know which PDF it belongs to in order to link into it.
 */
function makeComponents(pdf?: PdfSource): Components {
  return {
  a: ({ href, children }) => {
    // A page citation, e.g. [p. 12] — already rewritten to a link by the
    // transform below. It opens the document at that page; without a document
    // attached it is still shown, just not clickable.
    const citedPage = href ? pageFromFragment(href) : null;
    if (citedPage) {
      const page = citedPage;
      const label = extractText(children).trim();
      const chip =
        "mx-px inline-flex h-4 items-center rounded-sm border border-primary/40 bg-primary/10 px-1 align-super font-mono text-[10px] leading-none text-primary";
      if (pdf?.url) {
        return (
          <a
            href={`${pdf.url}#page=${page}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${pdf.name ?? "the document"} at page ${page}`}
            className={`${chip} transition-colors hover:bg-primary hover:text-primary-foreground`}
          >
            {label}
          </a>
        );
      }
      return <span className={chip}>{label}</span>;
    }

    const safeHref = href ? sanitizeUrl(href) : undefined;
    const text = extractText(children).trim();
    if (safeHref && /^\d+$/.test(text)) {
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-primary/40 bg-primary/10 px-0.5 align-super font-mono text-[10px] leading-none text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          {text}
        </a>
      );
    }
    if (!safeHref) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary"
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safeSrc = typeof src === "string" ? sanitizeUrl(src, true) : undefined;
    if (!safeSrc) return null;
    return (
      <img
        src={safeSrc}
        alt={alt ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-w-full rounded-[var(--radius-sm)]"
      />
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => {
    const isBlock =
      typeof className === "string" &&
      (className.includes("hljs") || className.includes("language-"));
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded-sm border border-primary/20 bg-primary/8 px-1 py-0.5 text-[0.85em] font-medium text-foreground">
        {children}
      </code>
    );
  },
  };
}

function MarkdownChunk({
  text,
  components,
}: {
  text: string;
  components: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeHighlight,
        [rehypeKatex, { throwOnError: false, strict: false, output: "html" }],
      ]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function MarkdownMessageBase({
  content,
  sources,
  pdfUrl,
  pdfName,
}: {
  content: string;
  sources?: Source[];
  /** The PDF the answer is about, so [p. 4] can open it at page 4. */
  pdfUrl?: string;
  pdfName?: string;
}) {
  const normalized = normalizeMessageContent(content);

  const withCitations = sources && sources.length > 0
    ? normalized.replace(/\[(\d+)\](?!\()/g, (match: string, n: string) => {
        const src = sources[parseInt(n, 10) - 1];
        return src ? `[${n}](${src.url})` : match;
      })
    : normalized;

  // [p. 12] / [pp. 12–14] from a document answer become links the renderer
  // recognises. Only rewritten when there is a document to point at —
  // otherwise the text stays exactly as written.
  const withPages = pdfUrl ? linkPageCitations(withCitations) : withCitations;

  const blocks = splitDisplayBlocks(withPages);
  // Keyed on the two strings, not on an object: a parent that rebuilds its
  // props each render (the transcript does) would otherwise invalidate this
  // memo on every keystroke and remount every block of a long answer.
  const components = useMemo(
    () => makeComponents(pdfUrl ? { url: pdfUrl, name: pdfName } : undefined),
    [pdfUrl, pdfName],
  );

  return (
    <div className="md-body">
      {blocks.map((block, i) => {
        if (!block.startsWith("$$")) {
          return <MarkdownChunk key={i} text={block} components={components} />;
        }
        // Display block: validate the TeX first. If KaTeX cannot parse it,
        // render the source in a readable code panel instead of letting KaTeX
        // dump raw red LaTeX into the message.
        const tex = block.slice(2, -2);
        let valid = true;
        try {
          katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: false });
        } catch {
          valid = false;
        }
        if (valid)
          return <MarkdownChunk key={i} text={block} components={components} />;
        return (
          <pre
            key={i}
            className="my-3 overflow-x-auto rounded-md border bg-muted/40 px-4 py-3 text-[13px] leading-6 text-muted-foreground"
          >
            {tex.trim()}
          </pre>
        );
      })}
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);