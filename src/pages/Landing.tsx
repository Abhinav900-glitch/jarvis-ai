// ---------------------------------------------------------------------------
// / — the home page for Jarvis AI.
//
// A focused, product-led landing: what Jarvis is, what it does, and a clear
// path into sign-in / guest flow. Reuses the project's hud visual language so
// it reads as part of the same product as the Dashboard, not a generic marketing
// page.
// ---------------------------------------------------------------------------

import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { Link } from "react-router";
import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Cloud,
  Download,
  FileText,
  Upload,
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
  Moon,
  Plus,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { JarvisLogo } from "@/components/jarvis-logo";
import { ReactorCore } from "@/components/reactor-core";
import { useAuth } from "@/hooks/use-auth";
import { PALETTES, usePalette } from "@/hooks/use-palette";
import { AUTHOR } from "@/lib/languages";

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

// The providers the router actually has legs into. Rendered as a marquee so the
// page states the breadth of the thing without a wall of logo cards.
const ENGINE_LABELS = [
  "Mistral",
  "Groq",
  "Eden AI",
  "Hugging Face",
  "OpenRouter",
  "Ollama",
  "Gemini",
  "NVIDIA NIM",
  "Meta (Muse)",
  "Cloudflare Workers AI",
] as const;

// Real turns a visitor can start with. Each one is a link, not decoration: the
// prompt lands in the composer already typed, so the landing page can hand off
// a worked example instead of a screenshot of one.
const STARTERS = [
  {
    label: "Plot it",
    prompt: "Plot y = sin(x) / x and explain what happens at x = 0",
    hint: "The graph is drawn under the reply",
  },
  {
    label: "Deep research",
    prompt: "Research the latest JWST results and cite your sources",
    hint: "Live web, numbered citations",
  },
  {
    label: "Make an image",
    prompt: "Generate an image of a neon city skyline at dusk",
    hint: "Cloudflare · fal · Meta · Cloudinary",
  },
  {
    label: "Test memory",
    prompt: "Remember that I deploy on Fridays, then tell me what you know about me",
    hint: "Stored now, retrieved in later turns",
  },
] as const;

const FAQS = [
  {
    q: "Do I have to bring my own API keys?",
    a: "No. Jarvis ships with keyed providers, so the assistant answers the moment you sign in or continue as a guest. Keys, MCP servers and extra integrations are opt-in — add them when you want a specific engine or tool.",
  },
  {
    q: "Which model is actually answering?",
    a: "Whichever engine the router scores highest for that turn. Every reply carries a provider badge and the reason it was chosen, and you can pin an engine when you want a specific one.",
  },
  {
    q: "Where do my conversations live?",
    a: "Signed in, they are stored under your account so you can revisit them. As a guest they live in the browser session and are not guaranteed to survive a device change. Either way, your prompts are not used to train the models that answer you.",
  },
  {
    q: "Can it use my own tools?",
    a: "Yes — add MCP servers with whatever auth they need, drop in plugin zips, or insert a skill into a turn. The assistant calls what you expose to it and nothing else.",
  },
  {
    q: "What does it cost to start?",
    a: "Nothing, and no card is asked for. Guests get the full assistant; integrations you connect run on your own accounts, so their limits are yours to manage.",
  },
] as const;

const stats = [
  { value: "25+", label: "Routable engines" },
  { value: "∞", label: "Stored conversations" },
  { value: "10", label: "Provider surface" },
  { value: "∞", label: "Your MCP surface" },
] as const;

/** Lands on the console with the prompt already typed. Signed-out visitors go
 *  through /auth first, and `returnTo` carries the whole path — Auth only
 *  accepts a same-origin path, which this is. */
function promptHref(prompt: string, isAuthenticated: boolean) {
  const target = `/dashboard?prompt=${encodeURIComponent(prompt)}`;
  return isAuthenticated ? target : `/auth?returnTo=${encodeURIComponent(target)}`;
}

function Wordmark({ className = "" }: { className?: string }) {
  return <JarvisLogo className={className} />;
}

export default function Landing() {
  const { isAuthenticated, isLoading } = useAuth();
  const { palette, setPalette } = usePalette();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // The marketing pages are the one place a theme switch has to exist without
  // the console's menu. It writes the same `jarvis-theme` key the Dashboard
  // seeds from, so the choice carries into the app.
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("jarvis-theme", next ? "dark" : "light");
    } catch {
      // storage can be blocked; the in-memory choice still applies
    }
  };

  // Reading progress. A spring, not the raw value: scroll events arrive in
  // bursts, and the bar should glide rather than step.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 26,
    restDelta: 0.001,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <motion.div
        aria-hidden
        style={{
          scaleX: progress,
          transformOrigin: "0% 50%",
          backgroundImage:
            "linear-gradient(90deg, var(--signal-violet), var(--signal-cyan), var(--signal-blue))",
        }}
        className="fixed inset-x-0 top-0 z-50 h-0.5"
      />
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
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
      <section className="relative isolate mx-auto w-full max-w-6xl px-6 pb-24 pt-16 sm:pb-28 sm:pt-28">
        {/* Ambient layer: a slow aurora and a floor grid that converges on the
            horizon. Decorative only, and behind the copy because `isolate` keeps
            the -z-10 child inside this section's own stacking context. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="fx-aurora" />
          <div className="fx-grid" />
          {/* The same core the opening is built on, kept as scenery so the
              landing and the first frame read as one product. Hidden where
              there is no room for it, and faint enough to sit behind copy. */}
          <ReactorCore className="absolute -right-32 -top-24 hidden size-[560px] opacity-[0.13] lg:block" />
        </div>

        <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-14 lg:grid-cols-[1.05fr_0.95fr]">
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
              Your own <span className="fx-gradient-text">Jarvis</span>.
              <br />
              One assistant that thinks, searches, and remembers.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-xl text-base leading-7 text-muted-foreground"
            >
              A personal assistant that routes each turn to the right engine,
              keeps long-term memory of what matters, searches the live web when a
              question needs it, and keeps going if one engine fails — the same turn
              is simply retried on another.
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
                <Link to="/auth">Try without signing in</Link>
              </Button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="text-xs text-muted-foreground"
            >
              No credit card. Guests get the full assistant, too.
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
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-3.5" strokeWidth={1.5} />
                  Live research with numbered citations
                </span>
              </div>
            </motion.div>

            {/* Skins are chosen in the console's menu too, but showing them here
                lets a visitor see the palette system without signing in. */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-2.5"
            >
              <p className="hud-label">Console skin</p>
              <div className="flex flex-wrap gap-2">
                {PALETTES.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPalette(option.id)}
                    aria-pressed={palette === option.id}
                    title={option.tagline}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
                      palette === option.id
                        ? "border-primary/60 bg-primary/10 text-foreground"
                        : "border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <span
                      aria-hidden
                      className="size-3.5 rounded-full border border-border"
                      style={{
                        background: `linear-gradient(135deg, ${option.swatch[0]} 0 50%, ${option.swatch[1]} 50% 100%)`,
                      }}
                    />
                    {option.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>

          {/* feature strip on the right, tool-grid style */}            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-0"
            >
              <div className="hud-panel overflow-hidden p-6">
                <p className="hud-label hud-label-cyan mb-4">What it does</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {pillars.map((p) => (
                    <motion.div
                      key={p.title}
                      whileHover={{ x: 3 }}
                      transition={{ type: "spring", stiffness: 340, damping: 26 }}
                      className="group flex items-start gap-3 rounded-lg bg-background/40 p-3 transition-colors hover:bg-accent/50"
                    >
                      <p.icon className="size-4 text-muted-foreground shrink-0 mt-0.5 transition-colors group-hover:text-foreground" strokeWidth={1.5} />
                      <div>
                        <p className="text-sm font-semibold leading-snug">{p.title}</p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{p.body}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
        </div>
      </section>

      {/* engine marquee */}
      <section
        aria-label="Engines Jarvis routes across"
        className="border-y border-border/50 bg-card/30"
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-6">
          <p className="hud-label mb-4 text-center">
            Routed across the engines you already run
          </p>
          <div className="fx-marquee">
            <div className="fx-marquee-track">
              {/* Rendered twice: the track slides exactly -50%, so the second
                  copy is what the first one scrolls into. Only one copy is
                  exposed to assistive tech. */}
              {[0, 1].map((copy) => (
                <div
                  key={copy}
                  aria-hidden={copy === 1}
                  className="flex shrink-0 items-center"
                >
                  {ENGINE_LABELS.map((name) => (
                    <span
                      key={`${copy}-${name}`}
                      className="flex items-center gap-8 px-8"
                    >
                      <span className="hud-label whitespace-nowrap text-foreground/75">
                        {name}
                      </span>
                      <span className="size-1 rounded-full bg-primary/60" />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* stat readout */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-6 pt-12">
        <div className="hud-panel grid grid-cols-2 gap-px overflow-hidden md:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-card/60 px-6 py-6 text-center transition-colors hover:bg-accent/40"
            >
              <p className="hud-glow-text text-3xl font-semibold tracking-tight">
                {s.value}
              </p>
              <p className="hud-label mt-2">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* your cloud — the thing an account adds that a guest cannot have */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-12 pt-6">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="hud-label hud-label-cyan">With an account</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
              Your own cloud, not a scratch folder.
            </h2>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              Half a gigabyte of storage that belongs to your account. Upload
              from your phone, open it on your laptop, and keep every deck, CSV
              and chart Jarvis builds — instead of scrolling back through a chat
              to find a link that expired.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-foreground/85">
              <li className="flex items-start gap-2">
                <Upload className="mt-0.5 size-3.5 shrink-0 text-primary" />
                Drop files in from any device; 64 MB per file, 512 MB in total.
              </li>
              <li className="flex items-start gap-2">
                <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />
                Files from a run are one click from being kept, not re-generated.
              </li>
              <li className="flex items-start gap-2">
                <Download className="mt-0.5 size-3.5 shrink-0 text-primary" />
                Download or delete anything, whenever. Nothing is locked in.
              </li>
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="px-7">
                <Link
                  to={
                    isAuthenticated
                      ? "/dashboard?panel=cloud"
                      : `/auth?returnTo=${encodeURIComponent("/dashboard?panel=cloud")}`
                  }
                >
                  Open your cloud
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <span className="text-xs text-muted-foreground">
                Free with a sign-in. Guests chat; accounts keep.
              </span>
            </div>
          </motion.div>

          {/* A depiction of the panel, in the same visual language. */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="hud-panel p-5"
            aria-hidden
          >
            <div className="flex items-center gap-2">
              <Cloud className="size-3.5 text-primary" />
              <span className="hud-label">Your cloud</span>
              <span className="ml-auto text-[10px] text-muted-foreground/70">
                312 MB of 512 MB
              </span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[61%] rounded-full bg-primary/70" />
            </div>
            <ul className="mt-4 divide-y divide-border/40 text-[11px]">
              {[
                { name: "q3-forecast.xlsx", meta: "148 KB · upload · just now" },
                { name: "revenue-chart.png", meta: "96 KB · from a run · 2m ago" },
                { name: "meeting-notes.md", meta: "4 KB · upload · yesterday" },
                { name: "quarterly-deck.pptx", meta: "1.8 MB · from a run · 3d ago" },
              ].map((row) => (
                <li key={row.name} className="flex items-center gap-2 py-2">
                  <span className="flex size-6 items-center justify-center rounded border border-border/50 bg-muted/40">
                    <FileText className="size-3 text-muted-foreground/70" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground/90">{row.name}</span>
                    <span className="block text-muted-foreground/60">{row.meta}</span>
                  </span>
                  <Download className="size-3 text-muted-foreground/50" />
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* starter prompts — real links into the console */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="hud-label hud-label-cyan">Try one</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Start with a real question.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Each of these opens the console with the prompt already typed —
            pick one and press Enter to see how the assistant handles it.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STARTERS.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link
                to={promptHref(s.prompt, isAuthenticated)}
                className="hud-panel fx-lift group flex h-full flex-col justify-between gap-6 p-5"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="hud-label hud-label-cyan">{s.label}</span>
                    <ArrowUpRight
                      className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
                      strokeWidth={1.5}
                    />
                  </div>
                  <p className="text-sm leading-6 text-foreground/90">
                    “{s.prompt}”
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground">{s.hint}</p>
              </Link>
            </motion.div>
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
          ].map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              className="hud-panel fx-lift group p-6"
            >
              <div className="flex items-center justify-between">
                <s.icon className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" strokeWidth={1.5} />
                <span className="hud-dot data-[tone=violet]:data-static=true" data-tone="cyan" />
              </div>
              <h3 className="mt-4 text-sm font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* questions */}
      <section className="mx-auto w-full max-w-3xl px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <p className="hud-label hud-label-cyan">Questions</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            Answered plainly.
          </h2>
        </motion.div>

        <div className="mt-10 border-y border-border/70">
          {FAQS.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={item.q} className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenFaq(open ? null : i)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-6 py-5 text-left"
                >
                  <span className="text-sm font-medium tracking-tight">
                    {item.q}
                  </span>
                  <motion.span
                    animate={{ rotate: open ? 45 : 0 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className="shrink-0 text-muted-foreground"
                  >
                    <Plus className="size-4" strokeWidth={1.5} />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      key="answer"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="pb-5 pr-10 text-sm leading-6 text-muted-foreground">
                        {item.a}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
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
          <div aria-hidden className="fx-beam opacity-40" />
          <div aria-hidden className="fx-sweep" />
          <div className="relative">
                <Zap className="mx-auto size-5 text-primary" strokeWidth={1.5} />
                <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                  Bring Jarvis online in under a minute.
                </h2>
                <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted-foreground">
                  Sign in with email or continue as a guest. Every conversation is
                  saved, memory is built as you go, you get a cloud of your own, you
                  can see exactly which engine replied, and you can add your own MCP
                  servers when you are ready.
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
