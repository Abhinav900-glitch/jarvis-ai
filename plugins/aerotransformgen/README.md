# AeroTransformGen plugin

A Claude Code plugin folder: include it, import it, and the AI gains the
plugin's features — putting the AeroTransformGen agent (Jarvis) on any site,
and knowing how the product actually works.

```
plugins/aerotransformgen/
├── .claude-plugin/plugin.json      manifest (name, version, description)
├── commands/
│   ├── embed.md                    /aerotransformgen:embed  — write the widget into a project
│   └── remove.md                   /aerotransformgen:remove — strip it back out
├── skills/
│   └── aerotransformgen/SKILL.md   product + widget + console knowledge
└── README.md
```

## Install

**Try it for one session** (no install step):

```bash
claude --plugin-dir ./plugins/aerotransformgen
```

**Validate the folder** before shipping changes:

```bash
claude plugin validate ./plugins/aerotransformgen   # add --strict to fail on warnings
```

**Publish it** — the repo root carries a `.claude-plugin/marketplace.json`
pointing at this folder, so once the repo is on GitHub anyone can do:

```bash
claude plugin marketplace add OWNER/REPO
claude plugin install aerotransformgen@aerotransformgen
```

(or `/plugin` in-session). Scopes: `user`, `project` (committed settings), or
`local`.

## What it gives the AI

| Feature | What happens |
| --- | --- |
| `/aerotransformgen:embed` | Finds the right document body (static HTML, Vite `index.html`, Next.js `app/layout.tsx` / `_document.tsx`), inserts or updates the widget tag, asks for the origin rather than guessing it. |
| `/aerotransformgen:remove` | Greps for `jarvis-embed.js` and removes only those tags. |
| Skill | The widget's attributes, the `/embed` postMessage protocol, the security model, and what the Work / Console / Preview tabs really do — so product answers match reality. |

The snippet it writes:

```html
<script src="https://YOUR-HOST/jarvis-embed.js" async
         data-label="Ask Jarvis" data-position="right" data-accent="#22d3ee"></script>
```

Inside the app, the **Plugin** tab in the overview builds the same snippet
visually (label, corner, accent, live preview) and copies it.

## Next rung

Add `.mcp.json` to this folder once the agent exposes a stateless MCP endpoint
(`/mcp` over Convex HTTP actions): the plugin then does not just *install* the
widget, it *drives* the agent — start a run, read status, fetch results — from
any MCP-aware client.
