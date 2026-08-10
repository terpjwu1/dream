# PROOF — dream v1 works end-to-end

*Generated 2026-08-10 (overnight autonomous build). Every command below was
actually executed; outputs are pasted verbatim (trimmed only for length).*

## What was built

The full v1 plan (7 milestones, all committed on `feat/v1`): a TypeScript CLI
implementing "dreaming" — out-of-band memory curation over Claude Code
session transcripts, per the AI Native DevCon 2026 talk (see NOTES.md,
plan in `~/.claude/plans/tender-squishing-rivest.md`, Codex-reviewed).

## Evidence 1 — Unit & integration tests: 55/55 passing

```
$ npx vitest run
 Test Files  9 passed (9)
      Tests  55 passed (55)
```

Coverage of the risk areas Codex's review flagged:
- real JSONL record shapes incl. `isMeta` guards, `toolUseResult` side
  channel, torn final lines of live sessions (`claudeCode.test.ts`)
- digester truncation, token budgeting, low-signal eviction (`digester.test.ts`)
- prevalence math: threshold edges, stale-memory bypass, **hallucinated
  session-id rejection** (`prevalence.test.ts`)
- proposal validation: path traversal, missing/duplicate targets, bad
  frontmatter, reserved files, unknown finding refs (`pipeline.test.ts`)
- **secret redaction** across 7 credential formats (`redact.test.ts`)
- budget abort: analyzer launches gated once the cost cap is crossed
  (`pipeline.test.ts`)
- branch mode on temp git repos: evidence commits, dirty-tree/detached-HEAD
  refusal; auto mode changelog with revertable prior content
  (`outputModes.test.ts`)

## Evidence 2 — Real-data dry run (24MB production transcript)

`dream run --project /Users/jwu/Documents/buddyReborn/buddy --dry-run`
against a real 24,535KB session transcript (1,132 tool calls, 43 errors):

```
run 2026-08-10-ddd6d3: 1 session(s) selected (0 already dreamed, 0 live)
digested 1 session(s), 30123 est. tokens total
analyzing 1 batch(es)…
analysis: 8 raw finding(s) from 1/1 session(s)
  filtered: "The Grep and Glob tools failed five times in a row with
   "posix_spawn 'rg'" (ripgrep binary not found)…" — seen in 1 session(s), need 2
  filtered: "git commands failed twice with exit 69 because a fresh Xcode
   update reset the license agreement…" — seen in 1 session(s), need 2
  … (6 more real findings, all correctly filtered)
prevalence: 0/8 finding(s) survive
sessions: 1/1 analyzed
usage: $3.601
no proposals this run
```

What this proves:
- the adapter parses real production transcripts;
- the digester compressed 24MB → ~30K tokens while keeping failure signal
  (the findings quote actual errors from the session);
- the analyzer agent produced *specific, correct* findings (the `rg`
  failures and Xcode license resets genuinely happened in that session);
- the **deterministic prevalence filter did its job**: one session cannot
  establish a cross-session pattern, so nothing was proposed;
- cost metering works ($3.60 recorded against the $5 default cap);
- dry-run touched nothing and advanced no watermark.

## Evidence 3 — Full loop on a controlled 3-session project

A controlled fixture: 3 synthetic Claude Code sessions (real JSONL format,
written to `~/.claude/projects/…-e2e-proj/`) in which the agent repeatedly
runs `npm run test:integration` before starting postgres (ECONNREFUSED in
all 3), plus one seeded memory (`db-setup.md`) that session 3 contradicts
("we renamed the makefile target: it's `make db-up` now").

### Run (real Claude agents, branch mode) — `run 2026-08-10-8bd89c`

```
run 2026-08-10-8bd89c: 3 session(s) selected (0 already dreamed, 0 live)
analysis: 2 raw finding(s) from 3/3 session(s)
prevalence: 2/2 finding(s) survive
findings:
  • [recurring_failure] Integration tests failed with `connect ECONNREFUSED
    127.0.0.1:5432` in all 3 sessions … — seen in 3/3 sessions
  • [stale_memory] Memory entry db-setup.md instructs `docker compose up -d db`,
    but the user says that is deprecated in favor of `make db-up` — seen in 1/3
    (admitted via the stale-memory bypass)
proposals (1): UPDATE db-setup.md
usage: $0.679
1 proposal(s) committed to branch dream/2026-08-10-8bd89c
```

The proposer merged both findings into ONE file update — fixed the stale
command *and* made the memory instruct starting the db proactively — with
the evidence commit body carrying rationale, prevalence stats, and the
verbatim user quote.

### Review + accept

```
$ dream review --project …/e2e-proj          # lists the branch, per-commit stat + evidence
$ dream review --project …/e2e-proj --accept
accepted dream/2026-08-10-8bd89c into main
```

### Memory store after accept (verbatim)

```markdown
---
name: db-setup
description: ALWAYS run `make db-up` before `npm run test:integration` — tests fail with ECONNREFUSED 127.0.0.1:5432 if postgres isn't up
metadata:
  type: project
  curatedBy: dream
  evidenceSessions:
    - 11111111-…
    - 22222222-…
    - 33333333-…
---

Integration tests need the local postgres container. Start it BEFORE running tests: …
- Do NOT use `docker compose up -d db` directly — … replaced it with `make db-up`.
```

MEMORY.md index regenerated; `dream status` shows `dreamed sessions: 3`,
`un-dreamed: 0`, `last run: … 1 proposal(s), $0.68`. The full loop —
init → run → branch commits → review → accept → smarter memory — works.

## Bugs the dogfooding itself caught (and their fixes, both now unit-tested)

1. **Proposer path prefixing** (run `…-c1c8f8`): the agent emitted
   `memory/db-setup.md` (its cwd view) instead of `db-setup.md`; strict
   validation rejected it. Fix: deterministic `normalizeProposalPath()` +
   sharper prompt. Failed-run semantics held: no watermark advance, sessions
   retried cleanly.
2. **JSON extraction truncated by inner backticks** (run `…-45e567`): the
   proposed memory file legitimately contains a fenced code block; the lazy
   fence regex stopped at those backticks mid-JSON-string. Fix:
   line-anchored fence closing + balanced-bracket scanner. Verified by
   re-parsing the actual failed output from the debug dir.

## Artifacts for inspection

- E2E project: `/private/tmp/claude-501/…/scratchpad/e2e-proj` (fixture
  transcripts in `~/.claude/projects/-private-tmp-…-e2e-proj/`; remove that
  dir to clean up)
- Run reports: `~/.dream/runs/<runId>/report.json` (+ staged digests per batch)
- Real-data dry-run report: `~/.dream/runs/2026-08-10-ddd6d3/report.json`
- Invalid-output debug captures: `~/.dream/runs/debug/`
- Total spend across all live runs: ~$5.9 (dry-run $3.60 on fable-5 +
  three E2E runs ≤ $0.91 each)

## Evidence 4 — Codex code review of the implementation, findings fixed

After the E2E proof, Codex reviewed the implementation (separately from its
earlier design review of the plan). It confirmed 11 areas sound (dry-run
watermark semantics, hallucinated-id rejection, commit-body redaction, git
preflights, torn-line handling…) and found real issues, all fixed with
regression tests (`test/codexReviewFixes.test.ts`; suite now **55/55**):

| Severity | Finding | Fix |
|---|---|---|
| HIGH | Watermark advanced before branch/auto output — output failure could mark sessions dreamed with no review artifact | `commitWatermark()` now runs only after output succeeds, and re-loads state to merge concurrent updates |
| HIGH | `report.json` persisted unredacted findings (only proposal-linked ones were redacted) | all findings redacted at report construction |
| HIGH | SDK `allowedTools` only auto-approves — it does not RESTRICT the tool surface | added `tools: ["Read","Grep","Glob"]` (verified against sdk.d.ts) alongside `allowedTools` + `dontAsk` |
| HIGH | Concurrent `dream run`s could double-analyze sessions | per-project O_EXCL run lock with stale-lock takeover |
| HIGH | Mid-commit failure in branch mode could carry staged changes back to the base branch | `git reset --hard` before restoring the original branch |
| MED | Symlink planted in the memory dir could redirect writes outside the store | `lstat`/`realpath` checks in `resolvePath` |
| MED | `dream review --accept` while checked out on a `dream/*` branch could merge a branch into itself | guard refuses review from `dream/*` |
| MED | Token accounting read main-loop `usage` instead of the SDK's preferred `modelUsage` | summed across `modelUsage` |
| LOW | Hard-clip marker overshot the token budget; JSON scan missed documents after prose brackets | both fixed |

Deferred (documented, not blocking v1): wiring an `abortController` into
in-flight SDK queries for mid-run budget cancellation (currently the budget
gates *new* launches only) — noted in the PR.

### Round 2 — Codex verified the fixes themselves

Codex then re-reviewed the fix commit per-finding: **4 VERIFIED** (watermark
ordering, branch-mode rollback, SDK `tools` option, `modelUsage` accounting),
**3 REGRESSION / 2 INCOMPLETE** on the rest. All round-2 issues fixed
(suite now **60/60**):

- **Lock ownership** — stale takeover now re-races an exclusive create
  instead of overwriting, and release verifies an owner token before
  deleting (a release can no longer remove someone else's lock).
- **Deep redaction** — `redactFinding` walks every string in the structure
  (`deepRedact`) instead of naming fields, so schema growth can't reopen a
  leak. Tested with secrets planted in `id`, `sessionIds`, and
  `relatedMemoryFiles`.
- **Write-time symlink defense** — memory writes now open with
  `O_NOFOLLOW`, closing the check-to-write race the lstat check alone left
  open.
- **extractJson ordering** — bare-text fallback now collects outermost
  parseable documents left-to-right and prefers the last, so prose JSON
  early in a response can't shadow the final answer and nested fragments
  still can't win.
- The review-command guard placement was confirmed safe as-is (only
  read-only git ops precede it; documented with a comment).

A final live E2E run (`2026-08-10-a88de8`) after these fixes re-analyzed the
same 3 sessions against the now-corrected memory store and produced
**0 findings, 0 proposals** ($0.22): the memory already encodes the lesson,
so dreaming converged instead of re-proposing — exactly the desired
fixed-point behavior. It also confirmed the restricted `tools` option works
live, and the `modelUsage` fix reports real input tokens (802 in / 1,669
out, vs. the old main-loop-only "15 in").

## How to re-verify tomorrow

```bash
cd /Users/jwu/Documents/dream
npm run build && npx vitest run          # 50 tests
node dist/cli.js status --project /Users/jwu/Documents/buddyReborn/buddy
node dist/cli.js run --project /Users/jwu/Documents/buddyReborn/buddy --dry-run   # ~$3-4 on fable-5
# or replay the accepted E2E history:
git -C ~/.claude/projects/-private-tmp-claude-501--Users-jwu-Documents-dream-df01243d-1957-4af5-9f0f-04eddcbb49fc-scratchpad-e2e-proj/memory log --stat
```
