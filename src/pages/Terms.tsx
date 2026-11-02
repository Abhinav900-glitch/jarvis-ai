// ---------------------------------------------------------------------------
// /terms — Terms & Conditions for Jarvis AI.
//
// Plain-language terms that tell a new visitor what they are signing up for
// before they create an account. Mirrors the landing page's visual language so
// it reads as part of the same product, not a generic legal page.
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowLeft, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTHOR } from "@/lib/languages";

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <svg
        className="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.74.077-1.472.143-2.213.194m-.396 0c.371.017.74.046 1.11.082m..502 0a6.075 6.075 0 010 1.224m0 0a6.075 6.075 0 00.502 1.224m0 0a6.075 6.075 0 010 1.224m0 0c.635.117 1.213.203 1.763.275m5.428 0a11.927 11.927 0 01-2.638 2.666c-.78.24-1.543.47-2.287.684m0 0a11.927 11.927 0 001.763.667m0 0a11.927 11.927 0 012.125 1.658m0 0a11.927 11.927 0 001.763.667"
        />
      </svg>
      <span className="text-sm font-semibold tracking-[0.22em]">JARVIS</span>
    </span>
  );
}

const principles = [
  {
    icon: Bookmark,
    title: "Owned by you",
    body: "Your conversations, memory, personas and images belong to your account. Nothing in Jarvis is trained from your prompts or used to fine-tune the models behind your account.",
  },
  {
    icon: Bookmark,
    title: "Scoped access",
    body: "Integrations ask only for what they need. A Canva connection can generate images; an MCP server can only call the tools you connect it to. You disconnect anything at any time from Settings.",
  },
  {
    icon: Bookmark,
    title: "Nothing runs from storage",
    body: "Plugin zips and MCP configs you upload are stored as files. They are read by name before you trust them, and nothing is executed, unpacked into your workspace, or sent anywhere else from here.",
  },
] as const;

const sections = [
  {
    heading: "What Jarvis is",
    body: "Jarvis is a personal AI assistant that routes every turn to the right model, remembers what matters across conversations, reads the live web when a question needs it, and calls tools — including your own MCP servers — when a task calls for them. It is a product made by a single creator and offered to other individuals.",
  },
  {
    heading: "Accounts and login",
    body: "You can sign in with email (a one-time verification code is sent to your address) or continue as a guest. Guests get the full assistant, but conversations are tied to the browser session and are not guaranteed to survive a device change. Signed-in accounts keep every conversation server-side and let you reconnect integrations like Canva.",
  },
  {
    heading: "Integrations and MCP servers",
    body: "Jarvis can call tools through MCP (Model Context Protocol) servers. You can connect Canva (using your own Canva OAuth token) and add your own MCP servers — public endpoints or aggregators — with the auth they require. You are responsible for the servers you connect and for the scopes or keys you grant them. Jarvis uses these servers on your behalf to answer your questions; it does not share your account or your other integrations with them beyond the calls you authorize.",
  },
  {
    heading: "Your data",
    body: "Conversations are stored in Jarvis's own database so you can revisit them. Memory is built from your conversations and stored the same way. Plugin files you upload stay in storage attached to your account. Jarvis does not sell your data, and it does not use your prompts to train the models that answer you.",
  },
  {
    heading: "Content you generate",
    body: "Images and other outputs are generated through the providers Jarvis is connected to. Those providers may keep copies under their own terms. Outputs you create are yours to use; Jarvis does not claim ownership of what it helps you make.",
  },
  {
    heading: "Changes to these terms",
    body: "These terms can change as the product changes. Material changes are posted here with a new date. Continued use after a change means you accept the updated terms.",
  },
  {
    heading: "Accounts we may suspend",
    body: "We may suspend or remove an account that abuses the service, violates these terms, or puts others at risk. Where we can, we will tell you why and how to fix it. Guest sessions can end without notice when they run out of room or the browser clears them.",
  },
  {
    heading: "Neither guaranteed nor professional advice",
    body: "Jarvis is a general assistant, not a lawyer, doctor, financial adviser or other professional. Do not treat its answers as professional advice. For anything important, check a qualified person or primary source.",
  },
] as const;

export default function Terms() {
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
            <Link to="/">
              <ArrowLeft className="size-3.5" />
              Back to Jarvis
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/">Get started</Link>
          </Button>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-20 pb-8 sm:pt-24">
        <p className="hud-label hud-label-cyan">Legal</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The rules for using Jarvis AI. Read them before you sign up — they are
          written to be read, not filed.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="mb-6 flex items-center gap-3">
          <Bookmark className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">
            Three things to know first
          </h2>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {principles.map((p) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="hud-panel p-6"
              data-tone="cyan"
            >
              <div className="flex items-center justify-between">
                <p.icon className="size-5 text-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
              </div>
              <h3 className="mt-4 text-sm font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="divide-y divide-border/70">
          {sections.map((s) => (
            <div key={s.heading} className="px-6 py-5 first:pt-0 last:pb-6">
              <h3 className="text-base font-semibold tracking-tight">{s.heading}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex w-full flex-col gap-3 px-6 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/terms" className="underline hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/resources" className="underline hover:text-foreground transition-colors">
              Resources &amp; developers
            </Link>
            <Link to="/" className="underline hover:text-foreground transition-colors">
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
