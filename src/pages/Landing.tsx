// ---------------------------------------------------------------------------
// / — the home page for Jarvis AI.
//
// A focused, product-led landing: what Jarvis is, what it does, and a clear
// path into sign-in / guest flow. Reuses the project's hud visual language so
// it reads as part of the same product as the Dashboard, not a generic marketing
// page.
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { Link } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Zap,
  Layers,
  Cpu,
  Radar,
  Globe,
  Mic,
  ShieldCheck,
  BookOpen,
  Server,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { AUTHOR } from "@/lib/languages";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

const pillars = [
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
    icon: Radar,
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
    icon: Mic,
    title: "Voice and vision, when you want them",
    body: "Speak instead of typing and watch the HUD react to the room. Live mode tracks your mic level, follows your mood, and answers aloud from the same engines.",
  },
] as const;

const stats = [
  { value: "25+", label: "Routable engines" },
  { value: "∞", label: "Stored conversations" },
  { value: "<800ms", label: "Routing overhead" },
  { value: "1", label: "Assistant to learn your habits" },
] as const;

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

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();

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

      {/* header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark />
        <nav className="flex items-center gap-1">
          {isLoading ? null : isAuthenticated ? (
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                Open Jarvis
                <ArrowUpRight className="size-3.5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/auth">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24 pt-16 sm:pb-28 sm:pt-28">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-7"
          >
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-background/60 p-2.5">
                <svg
                  className="size-7 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-2.25 2.25m0 0l-2.25 2.25M12 12l3.75-3.75M12 12l-3.75 3.75m3.75 3.75l-2.25 2.25m-9.75-6l9 0"
                  />
                </svg>
                <span className="hud-dot absolute -top-0.5 -right-0.5 size-2.5 bg-emerald-400 shadow-sm" />
              </div>
              <span className="hud-label hud-label-cyan">Personal AI · Build 05</span>
            </div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-2xl text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-5xl"
            >
              Your own Jarvis.
              <br />
              Thinks, searches, remembers.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-xl text-base leading-7 text-muted-foreground"
            >
              A personal assistant that routes every turn to the right model,
              keeps long-term memory of what matters, reads the live web when a
              question needs it, and never goes dark — if one engine fails, the
              same turn simply retried on another.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-wrap items-center gap-3 pt-2"
            >
              <Button asChild size="lg" className="px-7">
                <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                  Start chatting
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="px-7">
                <Link to="/auth">Continue as guest</Link>
              </Button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-xs text-muted-foreground"
            >
              No credit card. Guests get the full assistant.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="pt-6"
            >
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" strokeWidth={1.5} />
                  Your conversations stay yours
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Code2 className="size-3.5" strokeWidth={1.5} />
                  Plugins and skills, stored as files
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Server className="size-3.5" strokeWidth={1.5} />
                  Your own MCP servers
                </span>
              </div>
            </motion.div>
          </motion.div>

          {/* feature strip on the right, tool-grid style */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-0"
          >
            <div className="hud-panel overflow-hidden p-6">
              <p className="hud-label hud-label-cyan mb-4">What it does</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pillars.slice(0, 6).map((p) => (
                  <div
                    key={p.title}
                    className="flex items-start gap-3 rounded-lg bg-background/40 p-3 transition-colors hover:bg-accent/20"
                  >
                    <p.icon className="size-4 text-muted-foreground shrink-0 mt-0.5" strokeWidth={1.5} />
                    <div>
                      <p className="text-sm font-semibold leading-snug">{p.title}</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{p.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* stat readout */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-6">
        <div className="hud-panel grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-card/60 px-6 py-6 text-center">
              <p className="hud-glow-text text-3xl font-semibold tracking-tight">
                {s.value}
              </p>
              <p className="hud-label mt-2">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="hud-label hud-label-cyan">How it works</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            A few surfaces, one assistant.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Chat is the main surface, but everything behind it — memory, search,
            plugins, your MCP servers — is reachable from the same account.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Zap, title: "Chat", body: "The main surface. Every turn routed, every answer from the right engine, with tools available when the assistant needs them." },
            { icon: BookOpen, title: "Memory", body: "Facts Jarvis has learned, surfaced when they matter. You can browse what it knows and forget anything." },
            { icon: Layers, title: "Plugins & MCP", body: "Your plugin zips and your own MCP servers live here. Add a server, give it a name and auth, and test it before you use it." },
            { icon: Cpu, title: "Engines", body: "See which engines are available, pin one you like, and understand why a particular answer came from a particular model." },
          ].map((s) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="hud-panel p-6 group"
            >
              <div className="flex items-center justify-between">
                <p.icon className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" strokeWidth={1.5} />
                <span className="hud-dot data-[tone=violet]:data-static=true" data-tone="cyan" />
              </div>
              <h3 className="mt-4 text-sm font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-2xl border border-border/60 px-8 py-16 text-center shadow-2xl"
          style={{
            background:
              "radial-gradient(ellipse 60% 100% at 50% 0%, color-mix(in oklab, var(--signal-blue) 22%, transparent), transparent 70%)",
          }}
        >
          <div className="relative">
            <Zap className="mx-auto size-5 text-primary" strokeWidth={1.5} />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              Bring it online in under a minute.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Sign in with email or continue as a guest. Every conversation is
              saved, memory is built as you go, and you can see exactly which
              engine replied — and add your own MCP servers when you are ready.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="px-7">
                <Link to={isAuthenticated ? "/dashboard" : "/auth"}>
                  Open Jarvis
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="px-7">
                <Link to="/auth">Sign in</Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* footer */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full flex-col gap-3 px-6 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/terms" className="underline hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link to="/resources" className="underline hover:text-foreground transition-colors">
              Resources &amp; developers
            </Link>
            <Link to="/auth" className="underline hover:text-foreground transition-colors">
              Sign in
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
