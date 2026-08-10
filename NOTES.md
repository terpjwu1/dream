# Dreaming — Notes from "Learning while you sleep: Beyond memory to dreaming"

Source: Lamis Mukta (Anthropic, Applied AI), AI Native DevCon June 2026
Video: https://www.youtube.com/watch?v=tTcxVv8HHNw (31:58)

## The core idea

**Dreaming is a second-order process over memory**: a batch, asynchronous,
out-of-band job with its own dedicated resources whose single objective is
curating memory. It reviews agent session transcripts against the existing
memory store, spots cross-session patterns, and proposes changes to the
memory store so agents "wake up smarter" the next day.

Three layers of the stack (18:12):

1. **Context** — the actual information agents reference at runtime.
2. **Memory processes** — agents autonomously read/write memory *in-band*
   (within a session).
3. **Dreaming** — out-of-band batch process that verifies, organizes, and
   enriches those memories between sessions.

## Why in-band memory alone isn't enough (15:23–17:06)

- **Split focus**: an agent asked to do a task AND curate memory faces a
  hard optimization problem — how much capacity to spend helping future
  runs vs. doing the actual task. Also adds latency.
- **Visibility limitation**: an agent only sees its own session. It cannot
  see patterns that recur *across* sessions ("agent keeps making the same
  mistake every session") or across a fleet of agents in different
  environments.
- **Memories go stale** (18:00): facts rot, get written incorrectly, or are
  maliciously prompt-injected. Something must re-verify them.

Analogy (17:14): a school. Students (agents) do the work; teachers and a
head teacher (dreaming) have *dedicated capacity* for learning and
*fleet-wide visibility* to spot patterns and steer the curriculum (memory).

## Background: how agent memory evolved (03:38–08:18, slide at 03:39)

CLAUDE.md → memory tools → skills → memory-as-filesystem:

- **CLAUDE.md**: single markdown file injected at session start —
  "unreasonably effective" but grows unboundedly.
- **Memory tools**: agents autonomously decide when to read/write/update
  memory, in-band. Autonomy works well.
- **Skills**: progressive disclosure — agent scans frontmatter (the
  "bookshelf of book titles"), loads the full body only when relevant.
  Great for procedural workflows, but human-driven curation is a bottleneck.
- **State of the art — memory as a file system**: plain markdown files;
  agents use ordinary tools (bash, grep) to search rather than bespoke
  memory APIs. Index well so search mirrors progressive disclosure.

Key learnings recap (08:22): markdown for reading; let memories grow large
but give agents tools to index/search; give agents autonomy when writing.

## Production guardrails for memory at scale (10:29–13:51)

Problems at scale (08:55): concurrent writes, one agent poisoning
org-wide context that everyone reads, human+agent co-editing confusion,
staleness/malicious injection.

Principles:

1. **Versioning** (10:42): every update attributed to an author and a
   session/transcript ("what context was this update based on"), full
   history, rollback support. Slide shows a `team/deploy.md` example with
   version chain `v1→v2→v3→v4 (head)`, `written_by: <session id>`, and a
   `content_sha256` precondition.
2. **Concurrency** (11:17): content-hash compare-and-swap. Agent takes a
   hash → drafts edit → re-hashes before writing → if hashes differ,
   another update landed; re-read, re-draft, retry commit.
3. **Permissions** (12:11): memory spans org-wide curated knowledge
   (probably read-only to agents) down to per-agent scratchpads (agent
   read/write), with team/cross-section scopes in between.
4. **Portability** (13:08): curated memory is a long-lived asset — design
   a clean API so it's accessible across product surfaces and systems.

Observed wins in production (14:07): higher accuracy on repeat tasks;
second-order cost/latency wins (fewer tokens, more one-shotting); frees
developer capacity because agents self-learn in the background.

## How dreaming works (18:52–23:47, diagram at 23:57)

Pipeline:

1. Input: the **memory store** (collection of memories, e.g. markdown files
   in a directory) + a batch of **session transcripts** over some period.
   Transcripts include not just user/agent message passes but **tool calls
   and metadata** — scrutinize those; tool-call failures are a key signal
   (21:04).
2. An **orchestrator deploys a fleet of subagents** that each analyze
   transcripts.
3. The orchestrator reviews subagent reports and decides where patterns
   are **prevalent enough** to warrant a memory change.
4. It proposes **individual changes to the memory store**, each backed by
   **evidence**: the transcripts where the pattern occurred plus stats on
   prevalence and why the change is warranted (23:16).
5. A **human reviews and accepts/rejects** each proposed change (23:37).

Steerability (22:28): the designer can tell both the memory-writing agents
and the dreaming orchestrator what kinds of things are and aren't
important/relevant for their org — curation is configurable.

Worked examples (19:55):
- Every geography student answers a question wrong → the topic is missing
  from the curriculum → add it to memory (fill a gap).
- Every maths student outputs radians instead of degrees → a systematic
  configuration error → add a "configure your calculator" instruction
  (in agent terms: spot a recurring tool-configuration failure in
  transcripts and record the fix).
- Fleet-wide style issue (everyone overusing dashes) → add an org-wide
  context change.

Dreaming's jobs, in short: **consolidate memory, cut what's no longer
relevant, add what agents are missing, clean up and organize** (26:33).

## Memory vs. dreaming — the two parallel processes (23:52 slide)

| | Memory (in-band) | Dreaming (out-of-band) |
|---|---|---|
| When | during the session, real-time | batch, asynchronously between sessions |
| Strength | short feedback loop — the very next session benefits | fleet-wide visibility; dedicated token budget for learning |
| Weakness | competes with the task for resources; single-session view | slower loop; needs its own infra |

Cost argument (24:48): dreaming looks expensive, but effective memory
stores drive costs *down* — agents one-shot tasks more often because they
have the information they need.

## Q&A insights (27:26–31:39)

- **Product pointer**: versioning/hashing/etc. as described are available
  in Anthropic's **memory and dreaming API through Claude Managed Agents**
  (28:23) — the talk's architecture mirrors that infrastructure.
- **Permissions × dreaming** (28:55): dreaming jobs don't have to ingest
  everything in a time window — you configure exactly which transcripts to
  attach, so you can scope a dreaming job to transcripts matching the
  memory store's permission set. Permissions and dreaming compose.
- **"Aren't we reinventing databases?"** (30:16): the boundary is shifting
  — early on, agents free-formed markdown commits; now proven primitives
  (hashing, versioning) are being codified deterministically into the
  harness. Draw the line between what agents do autonomously and what the
  harness does programmatically; don't reinvent the wheel where the signal
  is clear.

## Three takeaways (slide at 25:13)

1. **Do the simple thing that works** — CLAUDE.md, well-defined skills,
   and agent-written memory already get you a long way. (Not
   coding-specific — she uses memory for presentation prefs too, 26:07.)
2. **Design for many, long-running agents** — productionizing to a fleet
   means permissioning, versioning, concurrency, and portability.
3. **Add dreaming to consolidate memory out of band** — verify, organize,
   enrich between sessions.

## Implications for building our dream feature

- Model the memory store as a directory of markdown files; don't invent a
  bespoke read/write API for agents — plain file tools + a good index.
- The dreaming job needs: (a) transcript ingestion including tool-call
  metadata, (b) an orchestrator/subagent fan-out for analysis, (c) a
  prevalence threshold before proposing changes, (d) evidence-backed
  change proposals (linked transcripts + stats), (e) a human accept/reject
  review surface.
- Build the guardrails first: versioned memory with authorship/session
  attribution, hash-based compare-and-swap writes, and permission scopes
  (org read-only vs. agent scratchpad). Dreaming inherits scope by
  filtering which transcripts it may read.
- Make the "what matters to us" steering prompt a first-class config knob
  for both memory writing and dreaming.
- Deterministic infra (versioning, CAS) belongs in the harness; judgment
  (what to remember, what's stale) belongs to the agent.
