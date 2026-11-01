#!/usr/bin/env python3
"""Build writing-skills.zip — a sample plugin for the Plugins & MCP screen.

Contains:
  plugin.json      manifest (name, version, skills)
  mcp.json        MCP-style config the app can store alongside the zip
  skills/         several Markdown "writing skills" the user asked for
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

OUT = Path("writing-skills.zip")

SKILLS_DIR = Path("skills")

skills: list[tuple[str, str]] = []
skills.append(("clarity.md", """\
# Clarity

- Prefer one idea per sentence.
- State the point before the explanation.
- Cut qualifiers that do not change the meaning ("very", "really", "basically").
- Use concrete nouns over abstract ones when the reader needs to picture something.

## Tightening pass

1. Read aloud.
2. Delete the weakest sentence in each paragraph.
3. Replace "in order to" with "to".
4. Replace "due to the fact that" with "because".
"""))
skills.append(("structure.md", """\
# Structure

- Open with the reader's question, not the author's process.
- Put the most important line first; supporting detail comes after.
- One paragraph, one job. If a paragraph does two things, split it.
- Use subheadings when the reader will scan.

## Common layouts

- **Answer-first**: point, evidence, caveat, next step.
- **Compare**: what differs, why it matters, when each applies.
- **Process**: precondition, steps in order, failure modes, end state.
"""))
skills.append(("tone.md", """\
# Tone

- Match the reader's level of urgency and expertise.
- In technical writing, neutral beats clever.
- Keep personality in examples, not in the instructions.
- Avoid sarcasm in anything the reader may be stressed about.

## Leveling

- Beginner: define terms on first use; avoid stacking jargon.
- Peer: skip the basics, focus on tradeoffs.
- Executive: lead with impact, then cost, then timeline.
"""))
skills.append(("editing.md", """\
# Editing

- Write the rough draft to think; edit for the reader.
- Cut before you polish.
- Replace a fuzzy verb with a precise one where it matters.
- Check for repeated sentence openings.

## Self-checklist

- [ ] Did I answer the question I set out to answer?
- [ ] Is the first sentence of each paragraph doing real work?
- [ ] Are the examples tighter than the abstractions?
- [ ] Would a tired reader still understand this?
"""))
skills.append(("style-guide.md", """\
# Style guide (working notes)

- Prefer active voice unless the actor is unknown or irrelevant.
- Use "we" sparingly; make clear who "we" is.
- Keep lists parallel: all nouns, all verbs, or all full sentences.
- Edge cases belong after the common path, not inside it.
- When two phrasings are both correct, pick the shorter one.

## Consistency rules

- Same term, same meaning, every time.
- One convention for code references, one for UI labels, one for files.
- Dates: spell out the format at first use if it matters.
"""))
skills.append(("email.md", """\
# Email writing

- Subject line should predict the body, not decorate it.
- First paragraph: why this exists.
- Keep requests in their own sentence or list item.
- Close with the specific next action and owner.

## Short email template

- Subject: decision needed: X
- Context: one line
- Options: A / B / C
- Recommendation: one line
- Asks: who decides, by when
"""))

plugin_json = {
    "name": "Writing Skills Pack",
    "version": "1.0.0",
    "kind": "plugin",
    "description": "Reusable writing skills: clarity, structure, tone, editing, style, and email.",
    "skills": [name for name, _ in skills],
    "author": "You",
}

mcp_json = {
    "mcpServers": {
        "writingSkills": {
            "command": "echo",
            "args": ["writing-skills loaded"],
            "description": "Placeholder MCP entry for the Writing Skills Pack. Replace with a real tool before enabling.",
        }
    },
}

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("plugin.json", json.dumps(plugin_json, indent=2) + "\n")
    z.writestr("mcp.json", json.dumps(mcp_json, indent=2) + "\n")
    for name, body in skills:
        z.writestr(f"skills/{name}", body + "\n")

print(f"Wrote {OUT}")
print(f"  plugin.json  (manifest)")
print(f"  mcp.json     (MCP config)")
for name, _ in skills:
    print(f"  skills/{name}")
