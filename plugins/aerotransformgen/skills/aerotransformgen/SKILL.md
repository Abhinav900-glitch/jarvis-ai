---
name: aerotransformgen
description: AeroTransformGen Dev (Jarvis) — a hosted coding agent with an embeddable widget. Use when the user wants to put their AI or agent on a website, customise or install the Jarvis embed widget, or asks how the agent's runs, console tabs, or preview work.
---

# AeroTransformGen Dev

The user's product: a hosted coding agent ("Jarvis") that plans, writes, verifies
and checkpoints code against a project workspace, plus a widget that puts that
agent on any third-party site.

## The widget

One drop-in tag; everything else is derived from the script's own URL:

```html
<script src="https://YOUR-HOST/jarvis-embed.js" async data-label="Ask Jarvis" data-position="right" data-accent="#22d3ee"></script>
```

| Attribute | Meaning | Default |
| --- | --- | --- |
| `data-label` | button text | `Ask Jarvis` |
| `data-position` | `right` or `left` corner | `right` |
| `data-accent` | hex colour for border, dot and glow (loader accepts 3- or 6-digit hex only, anything else falls back) | `#22d3ee` |
| `data-open` | `"true"` opens the card on load | closed |

Programmatic control on the host page: `window.JarvisEmbed.open()`, `.close()`,
`.toggle()`. The loader is idempotent (double-inclusion mounts one widget),
renders into a shadow root so host CSS cannot break it, and lives in `public/`
of the app repo — served at `/jarvis-embed.js`.

In the app itself there is a **Plugin** tab in the overview that builds this
snippet: label, corner and accent with a live preview, then a copy button.

## What the widget actually mounts

An iframe at `https://YOUR-HOST/embed` — the same agent panel as the app, at
full bleed. The protocol is two messages, frame → host only:

```json
{ "source": "jarvis-embed", "type": "ready" }
{ "source": "jarvis-embed", "type": "close" }
```

The host owns visibility; the frame only reports. The frame runs on the app's
own origin behind `RequireAuth`, so sign-in happens inside the widget (OTP code
or guest) and the host page never sees credentials or holds a handle on the
frame (`sandbox` without `allow-same-origin` would break auth; the loader uses
`allow-scripts allow-same-origin allow-forms allow-popups` and nothing more).

## Inside the agent

- **Work tab** — the run: planning → tool rounds → verify-and-repair → result,
  with approve/approve-all gates when it wants to write. Modes: live, auto
  (default), plan-only.
- **Console tab** — per-round request/response log (cap 80 entries), a trace
  inspector (last 12 rounds, bodies clipped at 12k chars, only records while
  Record is on), and a static HTML/CSS/JS preview builder.
- **Preview tab** — renders the generated doc.
- Budget rails exist and are deliberate: auto-write is capped, checkpoints are
  kept to a bounded history, free-tier model calls are counted per run.

Backend is Convex (`src/convex/`), React + Vite + Tailwind + shadcn on the
front end. Never expose API keys to the client — Convex holds them.

## Tasks this plugin exists for

1. **Install the widget** → see the `embed` command; it decides origin, snippet
   and file placement (static HTML, Vite, or Next.js layouts).
2. **Remove it** → the `remove` command.
3. **Answer product questions** → the sections above; be honest about limits
   (static preview only, caps above) rather than overselling.
