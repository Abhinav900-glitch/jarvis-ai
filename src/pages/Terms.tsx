// ---------------------------------------------------------------------------
// /terms — Terms & Conditions for Jarvis AI.
//
// The clauses are the product's real commitments — free, no tracking cookies,
// open to every country, AI output provided as-is — so the page is built to be
// read: a sticky index, numbered clauses, and the three things a visitor is
// most likely to care about pulled to the top instead of buried in section 7.
// Visual language matches the landing page so this reads as part of the
// product, not as a legal annex bolted onto it.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router";
import {
  ArrowLeft,
  Globe2,
  Mail,
  Scale,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { JarvisLogo } from "@/components/jarvis-logo";
import { AUTHOR } from "@/lib/languages";

// One edit point: change the address here and both the clause and the contact
// card follow.
const CONTACT_EMAIL = "support@yourwebsite.com";

const LAST_UPDATED = "November 8, 2026";

function Wordmark({ className = "" }: { className?: string }) {
  return <JarvisLogo className={className} />;
}

const highlights = [
  {
    icon: Wallet,
    title: "Free, with no payments",
    body: "No subscriptions, no billing details, no card on file.",
  },
  {
    icon: ShieldCheck,
    title: "No tracking cookies",
    body: "No advertising trackers and no cross-site profiling.",
  },
  {
    icon: Globe2,
    title: "Open worldwide",
    body: "Available in every country, under your local law.",
  },
] as const;

interface Clause {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

const clauses: Clause[] = [
  {
    id: "acceptance",
    title: "Global accessibility & acceptance of terms",
    paragraphs: [
      "This website is intended for a global audience and is accessible to users from all countries. By browsing our website, using our tools, or interacting with our services, you acknowledge that you have read, understood, and agree to comply with these terms, regardless of your country of residence. If you do not agree, you must immediately stop using our services.",
    ],
  },
  {
    id: "payments",
    title: "No financial transactions or payments",
    paragraphs: [
      "Our website and services are entirely free to use. We do not process payments, sell products, or request financial details, credit card numbers, or billing information. Any request for payment claiming to originate from our platform is unauthorized and should be treated as fraudulent.",
    ],
  },
  {
    id: "privacy",
    title: "Privacy & tracking cookies",
    paragraphs: ["We value your digital privacy. This website operates under a strict data-minimization model:"],
    bullets: [
      "We do not deploy tracking cookies, marketing cookies, or third-party advertising trackers.",
      "We do not profile your browsing habits across the web, and we do not collect personally identifiable information (PII) for commercial marketing.",
      "Any technical logs kept by our servers are used strictly for security, stability, and platform optimization.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    paragraphs: [
      "You agree not to misuse our platform. Prohibited activities include, but are not limited to:",
    ],
    bullets: [
      "Violating any local, state, national, or international laws or regulations within your jurisdiction.",
      "Reverse engineering, scraping, or attempting to extract the source code or HTML infrastructure of our software.",
      "Using automated systems, scripts, bots, or malicious inputs to disrupt, overload, or harm our server infrastructure.",
      "Uploading malicious code or viruses, or engaging in unauthorized data collection.",
    ],
  },
  {
    id: "intellectual-property",
    title: "Intellectual property",
    paragraphs: [
      "All content, branding, logos, software, HTML code, graphics, and design elements featured on this platform are the exclusive property of our company or its licensors. You are granted a limited, non-exclusive, non-transferable license to access the site for personal or internal business use only.",
    ],
  },
  {
    id: "ai-output",
    title: "AI-generated output & content",
    paragraphs: [
      "If our platform provides or utilizes AI-generated assets, code, or text, you acknowledge that such outputs are provided \u201cas-is.\u201d We do not guarantee the absolute uniqueness, accuracy, or global copyright eligibility of AI-assisted generation, and you assume all risks associated with its practical or commercial use.",
    ],
  },
  {
    id: "liability",
    title: "Limitation of liability & disclaimers",
    paragraphs: [
      "Our services are provided on an \u201cAS IS\u201d and \u201cAS AVAILABLE\u201d basis without warranties of any kind, whether express or implied. To the maximum extent permitted by applicable law across all global jurisdictions, in no event shall our company, its developers, or affiliates be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data or goodwill, arising out of your use of the platform.",
    ],
  },
  {
    id: "jurisdiction",
    title: "Global jurisdiction & dispute resolution",
    paragraphs: [
      "Because this platform is available worldwide, you agree that any disputes arising out of these terms will first be attempted to be resolved through informal negotiation. If a legal resolution is required, it shall be governed by the laws of the main jurisdiction where our operational infrastructure or company registry is based, without regard to international conflict of laws.",
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    paragraphs: [
      "We reserve the right to modify or replace these terms at any time to reflect changing global regulations. We will notify users of updates by changing the \u201cLast Updated\u201d date at the top of this document.",
    ],
  },
  {
    id: "contact",
    title: "Contact information",
    paragraphs: [
      "If you have any questions or concerns regarding these terms, please write to us at",
    ],
  },
];

export default function Terms() {
  // Scroll-spy for the index: the reader can always see where they are in a
  // page this long, and the current clause is reachable without hunting.
  const [activeId, setActiveId] = useState(clauses[0].id);

  // Driven by an external observer, not by a render-time value.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const clause of clauses) {
      const el = document.getElementById(clause.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), var(--signal-violet), transparent)",
        }}
      />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark />
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/" aria-label="Back to Jarvis">
              <ArrowLeft className="size-3.5" />
              <span className="hidden sm:inline">Back to Jarvis</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/auth">Get started</Link>
          </Button>
        </nav>
      </header>

      {/* Hero: what this page is, when it changed, and the three promises a
          reader would otherwise have to hunt for. */}
      <section className="mx-auto w-full max-w-6xl px-6 pt-10 pb-10 sm:pt-16">
        <p className="hud-label hud-label-cyan">Legal</p>
        <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          Terms and Conditions
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          The rules for using this platform, written to be read rather than
          filed. By using the service you agree to them — here is the short
          version first.
        </p>
        <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
          Last updated · {LAST_UPDATED}
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {highlights.map((h, i) => (
            <motion.div
              key={h.title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.45,
                delay: 0.05 * i,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="hud-panel p-5"
              data-tone="cyan"
            >
              <h.icon className="size-4 text-foreground" strokeWidth={1.5} />
              <p className="mt-3 text-sm font-semibold tracking-tight">
                {h.title}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {h.body}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Index + clauses. The index sticks on wide screens so a reader can
          jump instead of scrolling a wall of numbered text. */}
      <section className="mx-auto w-full max-w-6xl flex-1 px-6 pb-20">
        <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="Contents" className="lg:sticky lg:top-6 lg:self-start">
            <p className="hud-label">Contents</p>
            <ol className="mt-3 space-y-1.5">
              {clauses.map((c, i) => {
                const isActive = c.id === activeId;
                return (
                  <li key={c.id}>
                    <a
                      href={`#${c.id}`}
                      aria-current={isActive ? "location" : undefined}
                      className={`group -ml-4 flex gap-2 border-l-2 pl-4 text-xs leading-5 transition-colors ${
                        isActive
                          ? "border-l-primary text-foreground"
                          : "border-l-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="font-mono text-[10px] tabular-nums opacity-60 group-hover:opacity-100">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>{c.title}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground/80">
              <Scale className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
              <p>
                Plain-language summary of the clauses below — the clauses
                themselves govern.
              </p>
            </div>
          </nav>

          <div className="max-w-3xl">
            <ol className="space-y-4">
              {clauses.map((c, i) => (
                <motion.li
                  key={c.id}
                  id={c.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="hud-panel scroll-mt-6 px-6 py-5"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h2 className="text-sm font-semibold tracking-tight sm:text-base">
                      {c.title}
                    </h2>
                  </div>
                  {c.paragraphs?.map((p) => (
                    <p
                      key={p.slice(0, 40)}
                      className="mt-2.5 text-sm leading-6 text-muted-foreground"
                    >
                      {p}
                    </p>
                  ))}
                  {c.bullets?.length ? (
                    <ul className="mt-3 space-y-2">
                      {c.bullets.map((b) => (
                        <li
                          key={b.slice(0, 40)}
                          className="flex gap-2.5 text-sm leading-6 text-muted-foreground"
                        >
                          <span
                            aria-hidden
                            className="mt-2 size-1 shrink-0 rounded-full"
                            style={{ background: "var(--signal-cyan)" }}
                          />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {c.id === "contact" ? (
                    <a
                      href={`mailto:${CONTACT_EMAIL}`}
                      className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs text-foreground transition-colors hover:bg-accent"
                    >
                      <Mail className="size-3.5" strokeWidth={1.5} />
                      {CONTACT_EMAIL}
                    </a>
                  ) : null}
                </motion.li>
              ))}
            </ol>

            <div
              className="hud-panel mt-6 flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              data-tone="violet"
            >
              <div className="flex items-start gap-3">
                <Sparkles
                  className="mt-0.5 size-4 shrink-0 text-foreground"
                  strokeWidth={1.5}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Questions about how your data is handled? Ask Jarvis directly
                  — it can explain any clause on this page in plain language.
                </p>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link to="/auth">Ask in the app</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full flex-col gap-3 px-6 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/terms"
              className="underline transition-colors hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              to="/resources"
              className="underline transition-colors hover:text-foreground"
            >
              Resources &amp; developers
            </Link>
            <Link
              to="/"
              className="underline transition-colors hover:text-foreground"
            >
              Home
            </Link>
          </div>
          <span className="inline-flex items-center gap-1.5">
            {AUTHOR.flag} {AUTHOR.name} · {AUTHOR.country}
          </span>
        </div>
      </footer>
    </motion.div>
  );
}
