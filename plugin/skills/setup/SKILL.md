---
name: setup
description: One-time dream setup for this project — install check, dream init, optional status line wiring. Use when the user wants to enable dreaming for a project, or another dream skill reports the project is not initialized.
user-invocable: true
allowed-tools:
  - Bash(dream *)
  - Bash(command *)
  - Edit
  - Read
---

# /dream:setup

1. **CLI check:** `command -v dream`. If missing, give the user these
   install steps and stop until done:
   ```
   git clone https://github.com/terpjwu1/dream.git && cd dream
   npm install && npm run build && npm link
   ```
   The CLI runs on the Claude Agent SDK, so it uses the same auth as
   Claude Code — no extra keys needed.
2. **Project opt-in:** run `dream init --project <cwd>`. This scaffolds
   `.dream/config.json`, creates the memory store, and (branch mode)
   turns the memory dir into a git repo. Dreaming only ever triggers for
   projects that have been initialized — this step IS the opt-in.
3. **Steering:** open `.dream/config.json` and ask the user one question:
   "what should dream pay attention to in this project?" Write their
   answer into the `steering` field. This is the highest-leverage knob.
4. **Ambient dreaming consent (explicit, off by default):** background
   runs spend real money, so `trigger.enabled` starts `false`. Tell the
   user the terms before flipping it: a run starts automatically at
   session start once ≥ `trigger.minSessions` (default 3) sessions are
   un-dreamed, and each run is capped at `budget.maxRunCostUsd` (default
   $5). Only if they agree, set `"trigger": { "enabled": true }` in
   `.dream/config.json`. If they decline, dreaming stays manual via
   `/dream:run` — say so and continue.
5. **Status line (optional, ask first):** if the user wants the 💤/🌙
   badge, wire `dream statusline` into `~/.claude/settings.json`:
   ```json
   { "statusLine": { "type": "command", "command": "<absolute path to dream> statusline" } }
   ```
   Resolve the absolute path with `command -v dream`. **If a statusLine is
   already configured, do NOT overwrite it** — show the user their existing
   command and explain they can chain it (a wrapper script that prints
   their current line, then a space, then `dream statusline`'s output) or
   skip the badge.
6. Confirm the end state: what was enabled (ambient vs manual dreaming,
   status line or not) and that `/dream:review` handles any proposals.
