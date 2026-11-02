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
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  MousePointer,
  Terminal,
  BookOpen,
  Code2,
  Cpu,
  Server,
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
          d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9.5 9.5h5v5h-5z"
        />
      </svg>
      <span className="text-sm font-semibold tracking-[0.22em]">JARVIS</span>
    </span>
  );
}

const stacks = [
  {
    icon: Layers,
    title: "One assistant, many engines",
    body: "Every message is scored across a registry of engines. Fast models take routine turns; when a task is hard or an engine is down, another picks up the same turn automatically — you never switch anything by hand.",
  },
  {
    icon: Cpu,
    title: "Reasoning when it helps",
    body: "Reasoning models are only called in when thinking actually helps — a proof or a debugging question earns the heavy model, while asking for a time zone does not. You get the best answer without paying for the slowest path every time.",
  },
  {
    icon: Terminal,
    title: "Live research on demand",
    body: "One toggle turns any prompt into live web research. Fresh results are pulled in, synthesized, and returned with numbered citations you can open and check.",
  },
  {
    icon: BookOpen,
    title: "Long-term memory",
    body: "Facts worth keeping are extracted, embedded and stored. Later turns retrieve and rerank them, so Jarvis recalls what it learned instead of starting from nothing.",
  },
  {
    icon: Globe,
    title: "Live tools, resolved in-chat",
    body: "Weather, time, currency, country data, news and an interactive calculator are resolved inside the chat rather than bolted on afterwards.",
  },
  {
    icon: Server,
    title: "Your own MCP servers",
    body: "Connect Canva's official MCP, or add your own MCP servers — public endpoints or aggregators — with the auth they require. The assistant calls the tools they expose on your behalf.",
  },
  {
    icon: Code2,
    title: "Plugins and skills",
    body: "Drop a plugin zip and it stays yours — listed, downloadable, and readable by name before you trust it. Skills can be inserted into a turn so the assistant can act on your instructions.",
  },
  {
    icon: MousePointer,
    title: "Voice and vision, when you want them",
    body: "Speak instead of typing and watch the HUD react to the room. Live mode tracks your mic level, follows your mood, and answers aloud from the same engines.",
  },
] as const;

const howToConnect = [
  {
    step: "01",
    title: "Connect Canva",
    body: "Sign in, open Settings, and connect Canva. The app stores your per-user OAuth token and refreshes it for you, so the assistant can generate and export designs through Canva's MCP.",
    needs: "A Canva account and an app with the scopes your flows need.",
  },
  {
    step: "02",
    title: "Add an MCP server",
    body: "Open Settings → MCP servers and add the endpoint. Give it a name, a prefix (so tool names don't collide), and the auth — none, a bearer token, or a custom header.",
    needs: "An MCP server URL and, if it is private, the key or token it expects.",
  },
  {
    step: "03",
    title: "Test the connection",
    body: "Hit Test on a server. Jarvis reaches it, lists its tools, and stores the count so you can see how many tools each server offers before you use it.",
    needs: "Nothing beyond the server being reachable from Jarvis's deployment.",
  },
  {
    step: "04",
    title: "Ask and let the assistant choose",
    body: "Once a server is connected, its tools are available on every turn. The assistant picks the right tool for the question — you do not route calls by hand.",
    needs: "A question that calls for it. Casual chat still works exactly as before.",
  },
] as const;

const resources = [
  {
    title: "MCP Spec",
    href: "https://modelcontextprotocol.io",
    target: "_blank",
    description: "The official MCP spec that the assistant and your servers speak.",
  },
  {
    title: "Canva Developers",
    href: "https://www.canva.com/developers/",
    target: "_blank",
    description: "Where to create a Canva app, set scopes, and register your redirect URI.",
  },
  {
    title: "Pipedream",
    href: "https://pipedream.com",
    target: "_blank",
    description: "A hosted MCP gateway you can point Jarvis at if you want an aggregator path.",
  },
  {
    title: "Composio",
    href: "https://composio.dev",
    target: "_blank",
    description: "Another MCP aggregation path — one key can unlock many integrations.",
  },
  {
    title: "Convex",
    href: "https://convex.dev",
    target: "_blank",
    description: "The backend and database behind your account's conversations and memory.",
  },
] as const;

const resourceIcons = {
  "MCP Spec": Terminal,
  "Canva Developers": Code2,
  Pipedream: Link2,
  Composio: Link2,
  Convex: BookOpen,
} as const;

export default function Resources() {
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
          <MousePointer className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">
            What you can do from here
          </h2>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stacks.map((s) => (
            <motion.div
              key={s.title}
              {...fadeUp}
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
          <Link2 className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">
            Connecting your own integrations
          </h2>
        </div>
        <div className="divide-y divide-border/70">
          {howToConnect.map((s) => (
            <div
              key={s.step}
              className="px-6 py-5 first:pt-0 last:pb-5 sm:flex sm:items-start"
            >
              <p className="hud-readout text-xs text-primary shrink-0 mr-4">
                {s.step}
              </p>
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{s.body}</p>
                {s.needs && (
                  <p className="mt-2 text-[10px] text-muted-foreground/60">
                    You need: {s.needs}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="mb-6 flex items-center gap-3">
          <ExternalLink className="size-4 text-primary" strokeWidth={1.5} />
          <h2 className="text-base font-semibold tracking-tight">External resources</h2>
        </div>
        <div className="space-y-1.5">
          {resources.map((r) => {
            const Icon = resourceIcons[r.title] ?? ExternalLink;
            return (
              <div
                key={r.title}
                className="group flex items-center gap-3 rounded-lg border border-border/70 px-5 py-3.5 transition-colors hover:bg-accent/20 hover:border-foreground/20"
              >
                <Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium group-hover:text-foreground">{r.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{r.description}</p>
                </div>
                <Link
                  to={r.href}
                  target={r.target}
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity"
                >
                  <ArrowRight className="size-3.5" />
                </Link>
              </div>
            );
          })}
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
