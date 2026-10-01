import katex from "katex";
import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { DesmosCalculator } from "@/components/desmos-calculator";
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
    <div className="my-4 overflow-hidden rounded-md border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {lang}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer components
// ---------------------------------------------------------------------------

const components: Components = {
  a: ({ href, children }) => {
    const safeHref = href ? sanitizeUrl(href) : undefined;
    const text = extractText(children).trim();
    if (safeHref && /^\d+$/.test(text)) {
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-0.5 align-super text-[10px] leading-none text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
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
        className="font-medium underline underline-offset-2 hover:text-foreground"
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
      <code className="rounded-sm border bg-muted/60 px-1 py-0.5 text-[0.85em] font-medium">
        {children}
      </code>
    );
  },
};

function MarkdownChunk({ text }: { text: string }) {
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
}: {
  content: string;
  sources?: Source[];
}) {
  const normalized = normalizeMessageContent(content);

  const withCitations = sources && sources.length > 0
    ? normalized.replace(/\[(\d+)\](?!\()/g, (match: string, n: string) => {
        const src = sources[parseInt(n, 10) - 1];
        return src ? `[${n}](${src.url})` : match;
      })
    : normalized;

  const blocks = splitDisplayBlocks(withCitations);

  return (
    <div className="md-body">
      {blocks.map((block, i) => {
        if (!block.startsWith("$$")) {
          return <MarkdownChunk key={i} text={block} />;
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
        if (valid) return <MarkdownChunk key={i} text={block} />;
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