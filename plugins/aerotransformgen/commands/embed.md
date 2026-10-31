---
description: Install the AeroTransformGen widget on the site in this project
argument-hint: "[origin] [label] [right|left] [accent]"
allowed-tools: Read Grep Glob Edit Write
---

Install the AeroTransformGen (Jarvis) widget into the current project.

User arguments: `$ARGUMENTS`

## 1. Origin

The widget's script URL is what tells it where your agent lives — it derives
every other URL from itself, so this is the only value that cannot be wrong.

- If the arguments contain something starting with `http`, use it.
- Otherwise look for a hint already in the project: an env var such as
  `AEROTRANSFORMGEN_ORIGIN`, or a previous `jarvis-embed.js` snippet.
- Otherwise **ask the user** for their AeroTransformGen app URL. Do not write a
  placeholder origin as though it were real.

## 2. Snippet

```
<script src="ORIGIN/jarvis-embed.js" async data-label="LABEL" data-position="SIDE" data-accent="#HEX"></script>
```

Defaults when the arguments do not override them: label `Ask Jarvis`,
position `right`, accent `#22d3ee`. `data-position` is `right` or `left`;
`data-accent` is a 3- or 6-digit hex colour. Keep the label short — it is
button text on someone else's page.

## 3. Where it goes

- **Static HTML / Vite**: immediately before `</body>` in the HTML entry
  (usually `index.html`).
- **Next.js App Router**: inside `<body>` in `app/layout.tsx`, as a plain
  `<script async>` tag. Do not create a client component just to hold it.
- **Next.js Pages Router**: inside `<body>` in `_document.tsx`.
- Any other framework: the equivalent document body, still before it closes.

First grep the project for `jarvis-embed.js`. If a tag already exists, update
its attributes in place rather than adding a second one — two loaders mount two
widgets.

## 4. Report

State the file you changed, the origin you used, and one line on what happens
next: a button appears bottom-right (or left), opens the agent in a sandboxed
iframe, and visitors sign in inside the widget. The host page never gets a
handle on the frame.
