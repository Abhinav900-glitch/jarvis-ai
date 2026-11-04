import katex from "katex";
import { Check, Copy } from "lucide-react";
import { memo, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { DesmosCalculator } from "@/components/desmos-calculator";
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

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

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