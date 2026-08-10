# dream

Out-of-band memory curation for coding agents — an implementation of the
"dreaming" concept from Lamis Mukta's AI Native DevCon 2026 talk
[*Learning while you sleep: Beyond memory to dreaming*](https://www.youtube.com/watch?v=tTcxVv8HHNw)
(see [NOTES.md](NOTES.md)).

While your coding agent sleeps, `dream` reviews its session transcripts,
finds cross-session patterns — recurring failures, knowledge it keeps
rediscovering, memories that have gone stale, tools that keep breaking —
and proposes **evidence-backed changes** to the agent's memory store.
You review each proposal with its citations and accept or reject it.
Next session, the agent wakes up smarter.

## Design principle

*Deterministic infra in the harness, judgment in the agent* (from the talk):

| Harness (plain TypeScript) | Agents (LLM) |
|---|---|
| Session discovery, watermark, live-session guard | Spotting cross-session patterns |
| Transcript digestion & truncation | Merging duplicate findings |
| Prevalence arithmetic | Judging what's worth remembering |
| Proposal validation, secret redaction | Drafting memory-file edits |
| Git branches, commits, changelog, MEMORY.md index | Writing the rationale |

## Quick start

```bash
npm install && npm run build
node dist/cli.js init   --project /path/to/project        # scaffold config + memory store
node dist/cli.js run    --project /path/to/project --dry-run
node dist/cli.js run    --project /path/to/project        # branch mode: proposals as git commits
node dist/cli.js review --project /path/to/project        # inspect; --accept / --reject
node dist/cli.js status --project /path/to/project
```

v1 reads **Claude Code** transcripts (`~/.claude/projects/<project>/*.jsonl`)
and curates the per-project `memory/` directory of markdown files.

## Review modes

- **branch** (default): proposals land as one commit each on a `dream/<date>-<id>`
  branch of the memory repo, evidence and prevalence stats in the commit body.
  Review with `dream review` or plain `git log`.
- **auto**: proposals apply immediately; `CHANGELOG.md` records why, the
  evidence, and the full prior content of every changed file for easy revert.

Set `"reviewMode"` in `.dream/config.json`, or override per run with `--mode`.

## Configuration (`.dream/config.json`)

The `steering` string tells the dreamer what matters in your project — it is
injected into every analysis and proposal prompt. Other knobs: prevalence
thresholds, session window/caps, per-run cost ceiling (`budget.maxRunCostUsd`),
and separate model choices for the analyzer fan-out vs. the proposer.

## Safety properties

- Analyzer agents run in a deny-by-default sandbox (read-only file tools,
  no user settings/hooks inherited).
- Every cited session id is validated against the sessions actually analyzed;
  hallucinated citations are dropped before prevalence counting.
- Secret patterns (API keys, tokens, JWTs, private keys) are redacted from
  every persisted string: memory content, rationales, evidence, commit
  bodies, changelog entries.
- The watermark only advances for sessions whose analysis succeeded, and
  never on `--dry-run`; failed sessions are retried next run.
- Sessions modified in the last 10 minutes are skipped as live.

## Architecture

Provider portability is designed in at two seams:

- **`TranscriptSource`** (`src/sources/`) — normalizes any agent's session
  format into a common record stream. v1: Claude Code. Planned: Codex
  (`~/.codex/sessions`), Gemini, Copilot.
- **`AgentRunner`** (`src/agents/runner.ts`) — provider-neutral execution
  port for the dreaming agents (workspace abstraction, zod-schema outputs,
  normalized usage; no Claude vocabulary). v1 implementation: Claude Agent
  SDK. Planned: OpenAI, Codex CLI, local models.

## v2 (not yet built)

Content-hash compare-and-swap writes · permission scopes (org read-only vs
agent scratchpad) · scheduling · subagent transcript analysis · additional
TranscriptSource + AgentRunner implementations · session-closure signal for
the live guard · direct CLAUDE.md editing · `dream revert` for auto mode.
