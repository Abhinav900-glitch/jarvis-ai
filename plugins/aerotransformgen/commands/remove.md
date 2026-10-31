---
description: Remove the AeroTransformGen widget from this project
argument-hint: "[path]"
allowed-tools: Read Grep Glob Edit Write
---

Remove the AeroTransformGen widget from the current project.

User arguments: `$ARGUMENTS` (optional: a file to restrict the removal to)

1. Grep the project for `jarvis-embed.js` (ignore `node_modules`, lockfiles,
   and this plugin's own files).
2. Delete every `<script ... jarvis-embed.js ...></script>` tag you find — and
   only those. If the user gave a path, restrict the search to it.
3. If nothing matches, say so plainly and stop; do not touch any other script
   tags, and do not remove the `/embed` route of the agent app itself.
4. Report which files changed.
