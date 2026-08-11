# dream

**Your coding agent makes the same mistake every session. `dream` fixes that while it sleeps.**

`dream` is a CLI that reads your agent's session transcripts overnight, finds
patterns no single session can see — recurring failures, knowledge the agent
keeps rediscovering, memories that have gone stale — and proposes
evidence-backed edits to its memory store as git commits you review. Accept
the good ones; next session, the agent wakes up smarter.

It's an implementation of "dreaming" from Lamis Mukta's AI Native DevCon 2026
talk, [*Learning while you sleep: Beyond memory to dreaming*](https://www.youtube.com/watch?v=tTcxVv8HHNw).

```console
$ dream run --project ~/code/myapp

run 2026-08-10-8bd89c: 3 session(s) selected (0 already dreamed, 0 live)
analyzing 1 batch(es)…
analysis: 2 raw finding(s) from 3/3 session(s)
prevalence: 2/2 finding(s) survive
findings:
  • [recurring_failure] Integration tests failed with `connect ECONNREFUSED
    127.0.0.1:5432` in all 3 sessions — postgres was never started first
    — seen in 3/3 sessions
  • [stale_memory] Memory entry db-setup.md instructs `docker compose up -d db`,
    but the user says that is deprecated in favor of `make db-up`
    — seen in 1/3 sessions (stale-memory bypass)
proposals (1): UPDATE db-setup.md
usage: $0.679

1 proposal(s) committed to branch dream/2026-08-10-8bd89c
review:  dream review --project ~/code/myapp
```

That's real output (see [PROOF.md](PROOF.md)). Two findings, merged by the
proposer into one memory update that both fixes the stale command *and*
teaches the agent to start postgres before running tests. You review the
commit — with citations — and merge or delete it.

A few numbers, all verified in [PROOF.md](PROOF.md):

- A **24 MB** production transcript (1,132 tool calls) digests to a **~30K-token**
  summary that preserves the failure signal — as low as ~8K tokens per session
  when batching.
- Runs cost **cents to a few dollars** ($0.22–$3.60 observed), under a hard
  budget cap ($5 default).
- After accepting a fix, a re-run over the same sessions produces
  **0 findings, 0 proposals** — dreaming converges instead of spamming your
  memory store with restatements of lessons already learned.

## How it works

```
  sessions (~/.claude/projects/*.jsonl)      memory store (memory/*.md, a git repo)
            │                                        │
            ▼                                        │
  1. select      watermark + live-session guard      │
            ▼                                        │
  2. digest      24 MB transcript → ~30K tokens,     │
                 tool calls & failures kept          │
            ▼                                        ▼
  3. analyze     sandboxed read-only agents ◀── memory snapshot + your steering
            ▼
  4. aggregate   merge duplicate findings; deterministic prevalence filter
            ▼
  5. propose     evidence-backed CREATE / UPDATE / DELETE proposals
            ▼
  6. output      one git commit per proposal on dream/<date>-<id>
            ▼
     you: dream review → --accept / --reject
```

The design principle, straight from the talk: **deterministic infra in the
harness, judgment in the agents.**

| Harness (plain TypeScript) | Agents (LLM) |
|---|---|
| Session discovery, watermark, live-session guard | Spotting cross-session patterns |
| Transcript digestion & truncation | Merging duplicate findings |
| Prevalence arithmetic | Judging what's worth remembering |
| Proposal validation, secret redaction | Drafting memory-file edits |
| Git branches, commits, changelog, MEMORY.md index | Writing the rationale |

If an agent hallucinates a session id, cites a pattern seen only once, or
tries to write outside the memory store, the harness rejects it — no model
involved in that decision.

## Quick start

Not on npm yet — build from source:

```bash
git clone https://github.com/terpjwu1/dream.git && cd dream
npm install && npm run build
npm link        # optional: makes `dream` available on your PATH
```

`dream` uses the Claude Agent SDK, so it needs the same auth as Claude Code
(a logged-in Claude Code install, or an Anthropic API key).

```bash
dream init   --project /path/to/project        # scaffold .dream/config.json + memory store
dream run    --project /path/to/project --dry-run   # full pipeline, writes nothing
dream run    --project /path/to/project        # proposals land as git commits
dream review --project /path/to/project        # inspect; --accept / --reject
dream status --project /path/to/project        # watermark, pending branches, last run
```

The one config knob worth setting immediately: `steering` in
`.dream/config.json` — a plain-English description of what matters in your
project, injected into every analysis and proposal prompt. Other knobs:
prevalence thresholds, session window/caps, per-run cost ceiling
(`budget.maxRunCostUsd`), and separate model choices for the analyzer
fan-out vs. the proposer.

## What a proposal looks like

Every proposal is one commit whose body carries the rationale, the prevalence
stats, and verbatim quotes from the sessions that justify it:

```
dream(update): db-setup

db-setup.md still instructs `docker compose up -d db`, but the user says the
team replaced it with `make db-up`; all three sessions also failed integration
tests because postgres was never started first.

Pattern seen in 3/3 analyzed sessions.

Evidence: session 11111111 — "connect ECONNREFUSED 127.0.0.1:5432"
Evidence: session 22222222 — "connect ECONNREFUSED 127.0.0.1:5432"
Evidence: session 33333333 — "we renamed the makefile target: it's `make db-up` now"

Run: 2026-08-10-8bd89c
Finding: finding-1 [recurring_failure]
```

You review with `dream review` or plain `git log --stat`. Accepting merges
the branch `--no-ff` into your memory repo; rejecting deletes it. Accepted
memories are attributed in frontmatter (`curatedBy: dream`, plus the evidence
session ids), and a `MEMORY.md` index is regenerated so agents can find them.

Prefer no review gate? `--mode auto` applies proposals immediately and writes
a `CHANGELOG.md` entry with the evidence and the full prior content of every
changed file, for easy revert.

## Why it's safe to run on real transcripts

- **Sandboxed analysis** — analyzer agents run with a restricted tool surface
  (`Read`/`Grep`/`Glob` only), no user settings or hooks inherited.
- **Secret redaction** — API keys, tokens, JWTs, and private keys are redacted
  from *everything persisted*: memory content, rationales, evidence quotes,
  commit bodies, changelog entries, run reports.
- **No single-session "patterns"** — a deterministic prevalence filter rejects
  any finding seen in fewer than 2 sessions (configurable), and every cited
  session id is validated against the sessions actually analyzed;
  hallucinated citations are dropped before counting.
- **Dry-run is really dry** — `--dry-run` runs the full pipeline but writes
  nothing and advances no watermark.
- **Honest watermark** — the watermark only advances for sessions whose
  analysis *and* output both succeeded; failed sessions are retried next run.
  Sessions modified in the last 10 minutes are skipped as live, and a
  per-project run lock prevents concurrent double-analysis.
- **Hard budget cap** — cost is metered per run; new agent launches stop once
  the cap is crossed.

64/64 tests cover exactly these properties (real JSONL edge cases, torn live
sessions, path traversal + symlink escapes, hallucinated-id rejection,
deep redaction across 7 credential formats, budget aborts, dirty-tree
refusal, mid-commit rollback, SDK sandbox-option conformance).

## Beyond Claude Code

v1 reads **Claude Code** transcripts and runs its agents on the **Claude
Agent SDK**. Provider portability is designed in at two seams:

- **`TranscriptSource`** (`src/sources/`) — normalizes any agent's session
  format into a common record stream. Planned: Codex (`~/.codex/sessions`),
  Gemini, Copilot.
- **`AgentRunner`** (`src/agents/runner.ts`) — provider-neutral execution
  port for the dreaming agents (workspace abstraction, zod-schema outputs,
  normalized usage). Planned: OpenAI, Codex CLI, local models.

Also on the roadmap: content-hash compare-and-swap writes, permission scopes
(org read-only vs. agent scratchpad), scheduling, subagent transcript
analysis, direct CLAUDE.md editing, and `dream revert` for auto mode.

## Status

v1 (`0.1.0`). Claude Code transcripts only, Claude Agent SDK required, not
yet published to npm. It works end to end — every claim above is backed by a
pasted command output in [PROOF.md](PROOF.md) — but expect rough edges.

## Credits

- Concept: Lamis Mukta (Anthropic), [*Learning while you sleep: Beyond memory
  to dreaming*](https://www.youtube.com/watch?v=tTcxVv8HHNw), AI Native DevCon
  2026. Detailed talk notes in [NOTES.md](NOTES.md).
- Created by [Steven Jieli Wu](https://stevenjieliwu.com/) — generative AI
  architect and educator; also the maker of Buddy, the AI coding companion.
- Built with Claude Code; design and implementation reviewed by Codex (all
  findings fixed with regression tests — see [PROOF.md](PROOF.md)).

MIT licensed.
