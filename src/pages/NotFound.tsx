import { motion } from "framer-motion";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { JarvisIcon } from "@/components/jarvis-icon";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="hud-grid-bg flex min-h-screen flex-col bg-background text-foreground"
    >
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--signal-cyan), var(--signal-blue), var(--signal-violet), transparent)",
        }}
      />

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="hud-panel hud-corners relative flex size-20 items-center justify-center rounded-2xl">
          <JarvisIcon className="size-9" animate />
          <span className="hud-dot absolute -top-1 -right-1" data-tone="amber" />
        </div>

        <p className="hud-label hud-label-cyan mt-8">Signal lost · 404</p>
        <h1 className="hud-glow-text mt-4 text-6xl font-semibold tracking-tight">
          404
        </h1>
        <p className="mt-4 max-w-sm text-center text-sm leading-6 text-muted-foreground">
          This route isn't on the network. The link may be mistyped, or the
          page may have moved.
        </p>

        <Button asChild size="lg" className="mt-9 px-7">
          <Link to="/">
            <ArrowLeft className="size-4" />
            Back to Jarvis
          </Link>
        </Button>
      </div>
    </motion.div>
  );
}