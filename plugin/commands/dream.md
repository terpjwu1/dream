---
description: Dream now — start a background dreaming run over this project's recent sessions and keep working (homage to Claude Code's original auto-dream trigger)
allowed-tools: ["Bash(dream trigger*)", "Bash(dream status*)"]
---

Start a dreaming run in the background for the current project, right now,
without interrupting the session — this is the classic in-session trigger.

1. Run `dream trigger --now --project <cwd>`.
2. Relay its one-line output verbatim:
   - `💤 dream: dreaming over N session(s) in the background` — tell the user
     they can keep working; the status line shows progress (if wired) and
     proposals will surface as a `🌙` badge for `/dream:review`.
   - `🌙 dream: N proposal branch(es) awaiting review — /dream:review` —
     there's already output waiting; offer to run `/dream:review` now.
   - `💤 dream: a dreaming run is already in progress` — nothing to do.
   - `dream: nothing to dream about …` — no un-dreamed sessions yet.
   - `dream: project not set up …` — offer to run `/dream:setup`.
3. Do not block waiting for the background run; it typically takes a few
   minutes and its results arrive via the badge / next session start.
