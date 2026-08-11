---
name: status
description: Show dream's state for this project — un-dreamed session backlog, pending proposal branches, last run cost. Use when the user asks what dream is doing, whether anything is pending, or how much runs have cost.
user-invocable: true
allowed-tools:
  - Bash(dream status*)
---

# /dream:status

1. Run `dream status --project <cwd> --json`.
2. Report in a friendly sentence or two:
   - whether the project is initialized for dreaming (if not: `/dream:setup`)
   - un-dreamed sessions in the window (the backlog)
   - pending `dream/*` branches awaiting review (if any: suggest `/dream:review`)
   - last run: when, proposals, cost, and whether it was partial
3. Do not dump the raw JSON unless the user asks for it.
