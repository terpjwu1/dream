---
name: run
description: Run the dream pipeline now over this project's recent sessions — digest transcripts, find cross-session patterns, propose memory updates. Use when the user asks to "dream now", analyze recent sessions, or update agent memory from transcripts.
user-invocable: true
allowed-tools:
  - Bash(dream run*)
  - Bash(dream status*)
---

# /dream:run — dream on demand

1. Check the backlog first: `dream status --project <cwd> --json`. Report
   how many un-dreamed sessions there are. If `initialized` is false, tell
   the user to run `/dream:setup` first and stop.
2. If the backlog is 0, say there is nothing to dream about and stop.
3. Ask whether the user wants a **dry run** (report only, free of side
   effects) or a **real run** (proposals land for review; costs money —
   runs are capped by `budget.maxRunCostUsd`, default $5).
4. Execute:
   - dry: `dream run --project <cwd> --dry-run`
   - real: `dream run --project <cwd>`
   This can take a few minutes — run it in the background if the harness
   supports it, and let the user keep working.
5. Summarize the run report: sessions analyzed, findings that survived the
   prevalence filter (with their evidence counts), proposals produced, and
   cost. If proposals landed, point the user to `/dream:review`.
