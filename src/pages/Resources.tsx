// ---------------------------------------------------------------------------
// /resources — Resources & developers page for Jarvis AI.
//
// For people who want to know what is under the hood, how to connect their own
// integrations (Canva, MCP servers), and where to go next. Mirrors the landing
// page's visual language so it reads as part of the product.
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { Link } from "react-router";
import {
  Layers,
  Radar,
  Server,
  Mic,
  BookOpen,
  Code2,
  Cpu,
  Globe,
  Terminal,
  Link2,
  MousePointer,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTHOR } from "@/lib/languages";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

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

const stackIcons = [Layers, Radar, Server, Mic, BookOpen, Code2, Cpu, Globe];
const howToIcon = MousePointer;
const externalIcon = ExternalLink;
const backIcon = ArrowLeft;
const openIcon = ArrowRight;
const linkIcon = Link2;
const terminalIcon = Terminal;
const codeIcon = Code2;
const bookIcon = BookOpen;

export default function Resources() {
  const stackIconsLocal = stackIcons;
  const fadeUpLocal = fadeUp;
  const fadeUpTransitionLocal = fadeUp.transition;
  const fadeUpInitLocal = fadeUp.initial;
  const fadeUpWhileLocal = fadeUp.whileInView;
  const fadeUpVpLocal = fadeUp.viewport;
  const motionLocal = motion;
  const linkIconLocal = linkIcon;
  const terminalIconLocal = terminalIcon;
  const codeIconLocal = codeIcon;
  const bookIconLocal = bookIcon;
  const howToIconLocal = howToIcon;
  const externalIconLocal = externalIcon;
  const backIconLocal = backIcon;
  const openIconLocal = openIcon;
  const usedStacks = [
    { icon: stackIconsLocal[0], title: "x", body: "x" },
    { icon: stackIconsLocal[1], title: "x", body: "x" },
    { icon: stackIconsLocal[2], title: "x", body: "x" },
    { icon: stackIconsLocal[3], title: "x", body: "x" },
    { icon: stackIconsLocal[4], title: "x", body: "x" },
    { icon: stackIconsLocal[5], title: "x", body: "x" },
    { icon: stackIconsLocal[6], title: "x", body: "x" },
    { icon: stackIconsLocal[7], title: "x", body: "x" },
  ];
  const usedMotion = motionLocal;

  return (
    <usedMotion.div
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
              <backIconLocal className="size-3.5" />
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

      <section className="mx-auto max-w-4xl px-6 pt-20 pb-10 sm:pt-24">
        <p className="hud-label hud-label-cyan">For builders</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          Resources &amp; developers
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground max-w-2xl">
          How Jarvis is put together, how to connect your own integrations, and
          where to go next if you want to build on top of it or run your own MCP
          servers.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-20">
        <div className="mb-6 flex items-center gap-3">
          <howToIconLocal className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">
            What you can do from here
          </h2>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {usedStacks.map((s) => (
            <motion.div
              key={s.title}
              {...fadeUpLocal}
              className="hud-panel p-6"
              data-tone="cyan"
            >
              <div className="flex items-start justify-between">
                <s.icon className="size-5 text-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
              </div>
              <h3 className="mt-4 text-sm font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="mb-6 flex items-center gap-3">
          <howToIconLocal className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">
            Connecting your own integrations
          </h2>
        </div>
        <div className="divide-y divide-border/70">
          <div
            className="px-6 py-5 first:pt-0 last:pb-5 sm:flex sm:items-start"
          >
            <p className="hud-readout text-xs text-primary shrink-0 mr-4">
              01
            </p>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Connect Canva</h3>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                Sign in, open Settings, and connect Canva. The app stores your
                per-user OAuth token and refreshes it for you, so the assistant
                can generate and export designs through Canva's MCP.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                You need: A Canva account and an app with the scopes your flows need.
              </p>
            </div>
          </div>
          <div
            className="px-6 py-5 first:pt-0 last:pb-5 sm:flex sm:items-start"
          >
            <p className="hud-readout text-xs text-primary shrink-0 mr-4">
              02
            </p>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Add an MCP server</h3>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                Open Settings → MCP servers and add the endpoint. Give it a name, a
                prefix (so tool names don't collide), and the auth — none, a bearer
                token, or a custom header.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                You need: An MCP server URL and, if it is private, the key or token it
                expects.
              </p>
            </div>
          </div>
          <div
            className="px-6 py-5 first:pt-0 last:pb-5 sm:flex sm:items-start"
          >
            <p className="hud-readout text-xs text-primary shrink-0 mr-4">
              03
            </p>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Test the connection</h3>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                Hit Test on a server. Jarvis reaches it, lists its tools, and stores
                the count so you can see how many tools each server offers before you
                use it.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                You need: Nothing beyond the server being reachable from Jarvis's
                deployment.
              </p>
            </div>
          </div>
          <div
            className="px-6 py-5 first:pt-0 last:pb-5 sm:flex sm:items-start"
          >
            <p className="hud-readout text-xs text-primary shrink-0 mr-4">
              04
            </p>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Ask and let the assistant choose</h3>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                Once a server is connected, its tools are available on every turn. The
                assistant picks the right tool for the question — you do not route
                calls by hand.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/60">
                You need: A question that calls for it. Casual chat still works exactly
                as before.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="mb-6 flex items-center gap-3">
          <externalIconLocal className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">External resources</h2>
        </div>
        <div className="space-y-1.5">
          <div
            className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
          >
            <terminalIconLocal className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium group-hover:text-foreground">MCP Spec</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">The official MCP spec that the assistant and your servers speak.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">
                <openIconLocal className="size-3.5" />
                Open MCP Spec
              </Link>
            </Button>
          </div>
          <div
            className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
          >
            <codeIconLocal className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium group-hover:text-foreground">Canva Developers</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Where to create a Canva app, set scopes, and register your redirect URI.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="https://www.canva.com/developers/" target="_blank" rel="noopener noreferrer">
                <openIconLocal className="size-3.5" />
                Open Canva Developers
              </Link>
            </Button>
          </div>
          <div
            className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
          >
            <linkIconLocal className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium group-hover:text-foreground">Pipedream</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">A hosted MCP gateway you can point Jarvis at if you want an aggregator path.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="https://pipedream.com" target="_blank" rel="noopener noreferrer">
                <openIconLocal className="size-3.5" />
                Open Pipedream
              </Link>
            </Button>
          </div>
          <div
            className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
          >
            <howToIconLocal className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium group-hover:text-foreground">Composio</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Another MCP aggregation path — one key can unlock many integrations.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="https://composio.dev" target="_blank" rel="noopener noreferrer">
                <openIconLocal className="size-3.5" />
                Open Composio
              </Link>
            </Button>
          </div>
          <div
            className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
          >
            <bookIconLocal className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium group-hover:text-foreground">Convex</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">The backend and database behind your account's conversations and memory.</p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="https://convex.dev" target="_blank" rel="noopener noreferrer">
                <openIconLocal className="size-3.5" />
                Open Convex
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t pt-7">
        <div className="mx-auto flex flex-col gap-3 px-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/terms">Terms</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/resources">Resources &amp; developers</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/">Home</Link>
            </Button>
          </div>
          <span className="inline-flex items-center gap-1.5">
            {AUTHOR.flag} {AUTHOR.name} · {AUTHOR.country}
          </span>
        </div>
      </footer>
    </usedMotion.div>
  );
}
