import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  Cpu,
  Gauge,
  Globe,
  Layers,
  Mic,
  Radar,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Link } from "react-router";
import { JarvisIcon } from "@/components/jarvis-icon";
import { UltronOrb } from "@/components/ultron-orb";
import { AUTHOR } from "@/lib/languages";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
};

const pillars = [
  {
    icon: Layers,
    tone: "cyan",
    title: "Multi-engine routing",
    body: "Every message is scored across the whole engine registry. Fast models take routine turns; when a task is hard or an engine is down, another picks up the same turn automatically — you never switch anything by hand.",
  },
  {
    icon: Gauge,
    tone: "blue",
    title: "Task-aware reasoning",
    body: "Reasoning models are only called in when thinking actually helps — a proof or a debugging question earns the heavy model, while asking for a time zone does not. You get the best answer without paying for the slowest path every time.",
  },
  {
    icon: Radar,
    tone: "cyan",
    title: "Deep Research",
    body: "One toggle turns any prompt into live web research. Fresh results are pulled in, synthesized, and returned with numbered citations you can open and check.",
  },
  {
    icon: Cpu,
    tone: "violet",
    title: "Long-term memory",
    body: "Facts worth keeping are extracted, embedded and stored. Later turns retrieve and rerank them, so Jarvis recalls what it learned instead of starting from nothing.",
  },
  {
    icon: Globe,
    tone: "blue",
    title: "Live tools",
    body: "Weather, time, currency, country data, a news wire and an interactive calculator — all resolved inside the chat rather than bolted on afterwards.",
  },
  {
    icon: Mic,
    tone: "cyan",
    title: "Voice and vision",
    body: "Speak instead of typing and watch the HUD react to the room. Live mode tracks your mic level, follows your mood, and answers aloud from the same engines.",
  },
];

const stats = [
  { value: "25", label: "Routable engines" },
  { value: "1M", label: "Largest context window" },
  { value: "<800ms", label: "Routing overhead" },
  { value: "∞", label: "Stored conversations" },
];

const specs = [
  { label: "Primary tier", value: "Groq · GPT-OSS 120B → Qwen 3.8" },
  { label: "Reasoning tier", value: "Mistral Medium · DeepSeek V3" },
  { label: "Fallback tier", value: "Hugging Face · Qwen2.5 / Gemma 2" },
  { label: "Extra provider", value: "Eden AI · Gemma 4" },
  { label: "Free tier", value: "OpenRouter · 12 free models" },
  { label: "Recall pipeline", value: "Embed → retrieve → rerank" },
  { label: "Search layer", value: "Serpstack live web results" },
  { label: "Language layer", value: "apilayer NLP" },
  { label: "News layer", value: "mediastack" },
  { label: "Image generation", value: "Cloudinary → Hugging Face → Pollinations" },
  { label: "Rendering", value: "Markdown · KaTeX · syntax highlighting" },
  { label: "Voice", value: "AssemblyAI STT · speech synthesis" },
  { label: "Persistence", value: "Convex — every chat saved" },
];

function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <JarvisIcon className="size-5" animate />
      <span className="text-sm font-semibold tracking-[0.22em]">JARVIS</span>
    </span>
  );
}

/** Small status strip — the "instrument is live" cue under the hero. */
function TelemetryStrip() {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {[
        { tone: "cyan", text: "CORE ONLINE" },
        { tone: "blue", text: "ENGINES ROUTED" },
        { tone: "blue", text: "MEMORY LINKED" },
      ].map((s) => (
        <span key={s.text} className="hud-label inline-flex items-center gap-2">
          <span className="hud-dot" data-tone={s.tone} />
          {s.text}
        </span>
      ))}
    </div>
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
      {/* Top signal rail — a thin lit strip that frames the page as a device. */}
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), var(--signal-violet), transparent)",
        }}
      />

      {/* Header */}
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

      {/* Hero */}
      <section className="hud-grid-bg hud-scanlines relative mx-auto grid w-full max-w-6xl items-center gap-14 px-6 pt-16 pb-24 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative">
          <motion.div {...fadeUp} className="mb-8 inline-flex">
            <div className="hud-panel hud-corners relative flex size-16 items-center justify-center">
              <JarvisIcon className="size-8" animate />
              <span className="hud-dot absolute -top-1 -right-1" data-tone="cyan" />
            </div>
          </motion.div>

          <motion.p {...fadeUp} className="hud-label hud-label-cyan">
            Personal AI · Build 05
          </motion.p>

          <motion.h1
            {...fadeUp}
            className="mt-6 max-w-2xl text-4xl font-semibold tracking-[-0.03em] text-balance sm:text-6xl"
          >
            <span className="hud-glow-text">Your own Jarvis.</span>
            <br />
            Thinks, searches, remembers.
          </motion.h1>

          <motion.p
            {...fadeUp}
            className="mt-6 max-w-xl text-base leading-7 text-muted-foreground"
          >
            A personal assistant that routes every turn to the right model,
            keeps long-term memory of what matters, reads the live web when a
            question needs it, and never goes dark — if one engine fails, the
            same turn simply retried on another.
          </motion.p>

          <motion.div {...fadeUp} className="mt-10 flex flex-wrap items-center gap-3">
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

          <motion.p {...fadeUp} className="mt-4 text-xs text-muted-foreground">
            No credit card. Guests get the full engine.
          </motion.p>

          <motion.div {...fadeUp} className="mt-10 border-t pt-6">
            <TelemetryStrip />
          </motion.div>
        </div>

        {/* The orb itself, running. Drag to spin, scroll to zoom. Webcam
            gestures are opt-in and only exist in the app, so nothing here
            asks for a camera — this is the same Three.js scene live mode
            uses, standing in for a screenshot. */}
        <motion.div
          {...fadeUp}
          className="relative mx-auto aspect-square w-full max-w-[460px]"
        >
          <div
            className="absolute inset-0 rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--signal-cyan) 26%, transparent), transparent 62%)",
            }}
          />
          <UltronOrb className="relative h-full w-full" />
          <p className="hud-label absolute inset-x-0 bottom-0 text-center">
            Drag to spin · scroll to zoom
          </p>
        </motion.div>
      </section>

      {/* Stat readout — four numbers, instrument style. */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-4">
        <div className="hud-panel grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-card/60 px-6 py-7 text-center">
              <p className="hud-glow-text text-3xl font-semibold tracking-tight">
                {s.value}
              </p>
              <p className="hud-label mt-2">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="mx-auto w-full max-w-6xl px-6 py-24">
        <motion.div {...fadeUp} className="max-w-2xl">
          <p className="hud-label hud-label-cyan">System capabilities</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Everything behind the reply, exposed.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            The engine that answered, what it cost, what it recalled and what it
            looked up are all visible in the interface. Nothing happens to your
            conversation that you cannot see.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <motion.div
              key={p.title}
              {...fadeUp}
              className="hud-panel group p-7 transition-transform duration-300 hover:-translate-y-0.5"
              data-tone={p.tone === "violet" ? "violet" : p.tone === "blue" ? "blue" : undefined}
            >
              <div className="flex items-center justify-between">
                <p.icon
                  className="size-5 text-foreground"
                  strokeWidth={1.5}
                />
                <span className="hud-dot" data-tone={p.tone} data-static="true" />
              </div>
              <h3 className="mt-5 text-base font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">{p.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Failover explainer */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div {...fadeUp} className="hud-panel hud-corners p-8 sm:p-12">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-4 text-foreground" strokeWidth={1.5} />
            <p className="hud-label">Failover</p>
            <h2 className="text-base font-semibold tracking-tight">
              Automatic failover
            </h2>
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {[
              {
                step: "01",
                title: "Route the turn",
                body: "The registry scores every configured engine against the task and picks a winner.",
              },
              {
                step: "02",
                title: "Detect failure",
                body: "Errors, empty replies, timeouts or outages trip the failover immediately.",
              },
              {
                step: "03",
                title: "Retry elsewhere",
                body: "The same conversation, on the next engine. You never notice the handoff.",
              },
            ].map((s) => (
              <div key={s.step}>
                <p className="hud-readout text-xs text-primary">{s.step}</p>
                <p className="mt-2 text-sm font-semibold">{s.title}</p>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Spec sheet */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.p {...fadeUp} className="hud-label hud-label-cyan">
          Under the hood
        </motion.p>
        <div className="hud-panel mt-6 divide-y divide-border/70 overflow-hidden">
          {specs.map((s) => (
            <div
              key={s.label}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-4 transition-colors hover:bg-accent/30"
            >
              <span className="hud-label">{s.label}</span>
              <span className="hud-readout text-sm font-medium">{s.value}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div
          {...fadeUp}
          className="hud-panel hud-scanlines relative overflow-hidden px-8 py-16 text-center"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 60% 100% at 50% 0%, color-mix(in oklab, var(--signal-blue) 22%, transparent), transparent 70%)",
            }}
          />
          <div className="relative">
            <Zap className="mx-auto size-5 text-primary" strokeWidth={1.5} />
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              Bring it online in under a minute.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              Sign in with email or continue as a guest. Every conversation is
              saved, memory is built as you go, and you can see exactly which
              engine replied.
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

      {/* Footer */}
      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <span className="hud-label">Routers · Memory · Live · Voice</span>
          <span className="inline-flex items-center gap-1.5">
            {AUTHOR.flag} Built by{" "}
            <span className="font-medium text-foreground">{AUTHOR.name}</span> ·{" "}
            {AUTHOR.country}
          </span>
        </div>
      </footer>
    </motion.div>
  );
}