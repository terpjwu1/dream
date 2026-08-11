---
name: review
description: Review pending dream memory proposals conversationally — summarize each with its evidence, then accept or reject per the user's decision. Use when the user asks to review dream proposals, when the status line shows a 🌙 badge, or after a background dreaming run reports proposals.
user-invocable: true
allowed-tools:
  - Bash(dream review*)
  - Bash(dream status*)
  - Read
---

# /dream:review — conversational proposal review

Dream runs produced one or more `dream/*` branches in this project's memory
repo. Each branch holds evidence-backed memory proposals (one commit per
proposal). Your job: present them faithfully, collect a decision, execute it.

## Steps

1. Run `dream review --project <cwd>` (no flags). This prints the pending
   branches (oldest first) and, for the current branch, every proposal
   commit with its rationale, prevalence stats, and evidence quotes.
   - If it prints "no pending dream/* branches", say so and stop.
   - In auto mode it prints the latest CHANGELOG entry instead — summarize
     that and stop (nothing to accept/reject).
2. For the current branch, summarize each proposal for the user:
   - operation + memory file (e.g. `UPDATE db-setup.md`)
   - the rationale in one sentence
   - prevalence (`seen in N/M analyzed sessions`)
   - 1–2 verbatim evidence quotes with session ids
   Present honestly — the evidence is the product. Do not editorialize the
   proposals into sounding better or worse than their citations support.
3. Ask the user: accept this branch, reject it, or leave it for later.
   Branches are reviewed one at a time, oldest first (CLI semantics).
4. Execute the decision:
   - accept → `dream review --project <cwd> --accept`
   - reject → `dream review --project <cwd> --reject`
   - later  → stop here
   If `--accept` reports a merge conflict, relay the CLI's recovery
   guidance verbatim and help resolve it only if the user asks.
5. If more branches remain, repeat from step 1. When none remain, tell the
   user the memory store is up to date — the accepted memories load
   automatically at the next session start.
