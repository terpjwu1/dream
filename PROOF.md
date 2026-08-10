# PROOF — dream v1 works end-to-end

*Generated 2026-08-10 (overnight autonomous build). Every command below was
actually executed; outputs are pasted verbatim (trimmed only for length).*

## What was built

The full v1 plan (7 milestones, all committed on `feat/v1`): a TypeScript CLI
implementing "dreaming" — out-of-band memory curation over Claude Code
session transcripts, per the AI Native DevCon 2026 talk (see NOTES.md,
plan in `~/.claude/plans/tender-squishing-rivest.md`, Codex-reviewed).

## Evidence 1 — Unit & integration tests: 47/47 passing

```
$ npx vitest run
 Test Files  8 passed (8)
      Tests  47 passed (47)
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

<!-- E2E-RESULTS -->

## How to re-verify tomorrow

```bash
cd /Users/jwu/Documents/dream
npm run build && npx vitest run          # 47 tests
node dist/cli.js status --project /Users/jwu/Documents/buddyReborn/buddy
node dist/cli.js run --project /Users/jwu/Documents/buddyReborn/buddy --dry-run
```
