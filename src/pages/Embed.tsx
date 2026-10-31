// ---------------------------------------------------------------------------
// /embed — the surface a third-party site loads inside its iframe.
//
// Deliberately thin: the panel already knows how to be a whole product, so
// this page only adds the two things an embed needs that a normal route does
// not — fill the frame instead of floating over a page, and tell the host when
// the user wants it gone.
//
// The protocol is two messages, both frame → host. The host owns whether the
// widget is visible (it created it), so there is nothing for the frame to
// command — only to report. Everything else (auth, runs, the console tabs)
// behaves exactly as it does in the app, because it is the same component.
//
//     { source: "jarvis-embed", type: "ready" }   // mounted, show it
//     { source: "jarvis-embed", type: "close" }   // user asked to close
// ---------------------------------------------------------------------------

import { useEffect } from "react";
import { AeroTransformGenPanel } from "@/components/aerotransformgen-panel";

const CHANNEL = "jarvis-embed";

export default function Embed() {
  const host = typeof window !== "undefined" ? window.parent : null;

  // Announce once. Guarded on actually being framed: opened directly, there is
  // no host to tell and postMessage to yourself would be noise.
  useEffect(() => {
    if (!host || host === window) return;
    host.postMessage({ source: CHANNEL, type: "ready" }, "*");
  }, [host]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <AeroTransformGenPanel
        open
        embed
        onClose={() => {
          if (host && host !== window) {
            host.postMessage({ source: CHANNEL, type: "close" }, "*");
          }
        }}
      />
    </div>
  );
}
