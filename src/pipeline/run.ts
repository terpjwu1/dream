import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner } from "../agents/runner.js";
import type { Config } from "../config.js";
import { digestSession } from "../digest/digester.js";
import { memoryDirFor } from "../config.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { runsDir } from "../paths.js";
import { ClaudeCodeSource } from "../sources/claudeCode.js";
import { applyLedgerDelta, loadState, markDreamed, saveState } from "../state.js";
import type { RunReport } from "../types.js";
import { writeBadge } from "../badge.js";
import { aggregateFindings, applyPrevalence, buildLedgerDelta } from "./aggregate.js";
import { analyzeBatches, packBatches, stageBatch } from "./analyze.js";
import { RunBudget, mapWithConcurrency } from "./budget.js";
import { generateProposals, redactFinding } from "./propose.js";
import { selectSessions } from "./select.js";

export interface RunOptions {
  since?: Date;
  maxSessions?: number;
  dryRun?: boolean;
}

/** The full dreaming pipeline. Deterministic orchestration; judgment in agents. */
export async function runPipeline(
  projectPath: string,
  config: Config,
  runner: AgentRunner,
  opts: RunOptions = {},
  log: (msg: string) => void = console.log,
): Promise<RunReport> {
  const runId = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const runDir = runsDir(runId);
  mkdirSync(runDir, { recursive: true });
  const state = loadState(projectPath);
  const store = new FileMemoryStore(memoryDirFor(projectPath, config));
  const budget = RunBudget.fromConfig(config);

  // 1. Select + digest
  const { selected, skippedLive, skippedDreamed } = await selectSessions(
    projectPath,
    config,
    state,
    opts,
  );
  log(
    `run ${runId}: ${selected.length} session(s) selected` +
      ` (${skippedDreamed} already dreamed, ${skippedLive} live)`,
  );
  if (selected.length === 0) {
    return emptyReport(runId, projectPath, opts.dryRun === true);
  }

  const badge = (text: string) => {
    if (!opts.dryRun) writeBadge(projectPath, text);
  };
  badge(`💤 dreaming — digesting ${selected.length} session(s)…`);
  const source = new ClaudeCodeSource();
  const perSessionBudget = Math.floor(
    config.budget.maxDigestTokensPerBatch / Math.min(selected.length, config.budget.batchSizeSessions),
  );
  const digests = await mapWithConcurrency(selected, 4, (ref) =>
    digestSession(ref, source.readSession(ref), { maxTokens: perSessionBudget }),
  );
  log(
    `digested ${digests.length} session(s), ` +
      `${digests.reduce((s, d) => s + d.approxTokens, 0)} est. tokens total`,
  );

  // 2. Stage + analyze
  const memorySnapshot = await store.snapshotMarkdown();
  const packed = packBatches(digests, config);
  const batches = packed.map((batch, i) =>
    stageBatch(runDir, i, batch, memorySnapshot, config.steering),
  );
  log(`analyzing ${batches.length} batch(es)…`);
  badge(`💤 dreaming — analyzing ${batches.length} batch(es)…`);
  const analysis = await analyzeBatches(batches, runner, config, budget);
  for (const err of analysis.failedBatchErrors) log(`  ⚠ analyzer failed: ${err}`);
  if (analysis.skippedForBudget > 0) {
    log(`  ⚠ ${analysis.skippedForBudget} batch(es) skipped — budget cap reached`);
  }
  log(
    `analysis: ${analysis.findings.length} raw finding(s) from ` +
      `${analysis.analyzedSessionIds.length}/${selected.length} session(s)`,
  );

  // 3. Aggregate (candidate-aware) + prevalence + ledger delta
  const storedCandidates = Object.values(state.candidates);
  const merged = await aggregateFindings(
    analysis.findings,
    storedCandidates,
    runner,
    config,
    budget,
  );
  const prevalence = applyPrevalence(
    merged,
    analysis.analyzedSessionIds,
    config,
    state.candidates,
  );
  const { surviving, rejected } = prevalence;
  for (const r of rejected) log(`  filtered: "${r.finding.summary}" — ${r.reason}`);
  for (const key of prevalence.matchedKeys) {
    log(`  candidate ${key.slice(0, 12)} matched by a current finding`);
  }
  log(`prevalence: ${surviving.length}/${merged.length} finding(s) survive`);
  const ledgerDelta = buildLedgerDelta(prevalence, analysis.analyzedSessionIds);
  if (ledgerDelta.upserts.length > 0) {
    log(
      `held as candidates (evidence accumulates across runs): ` +
        ledgerDelta.upserts.map((u) => `"${u.summary.slice(0, 70)}"`).join(", "),
    );
  }

  // 4. Propose
  badge(`💤 dreaming — drafting memory proposals…`);
  const { proposals, invalid } = await generateProposals(
    surviving,
    store,
    runner,
    config,
    budget,
  );
  for (const bad of invalid) log(`  ⚠ invalid proposal ${bad.path}: ${bad.reason}`);

  // Findings persist to report.json and terminal output — redact ALL of
  // them, not just the proposal-linked ones (Codex code-review finding).
  const report: RunReport = {
    runId,
    projectPath,
    sessionsSelected: selected.length,
    sessionsAnalyzed: analysis.analyzedSessionIds,
    sessionsFailed: analysis.failedSessionIds,
    findings: merged.map(redactFinding),
    survivingFindings: surviving.map(redactFinding),
    proposals,
    ledgerDelta,
    usage: budget.snapshot(),
    partial: budget.wasAborted() || analysis.failedSessionIds.length > 0,
    dryRun: opts.dryRun === true,
  };
  writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
  return report;
}

/**
 * Advance the per-session watermark. Called by the CLI only AFTER output
 * (branch commits / auto apply) has succeeded, so a failed output never
 * marks sessions dreamed without producing review artifacts. Never called
 * on dry runs. State is re-loaded here so a long pipeline doesn't clobber
 * updates written since the run began.
 */
export function commitWatermark(projectPath: string, report: RunReport, config: Config): void {
  if (report.dryRun) return;
  const fresh = loadState(projectPath);
  let next = markDreamed(fresh, report.sessionsAnalyzed, report.runId);
  if (report.ledgerDelta) {
    next = applyLedgerDelta(next, report.ledgerDelta, {
      sinceDays: config.transcripts.sinceDays,
      maxPerCategory: config.ledger.maxPerCategory,
      maxMissedRuns: config.ledger.maxMissedRuns,
    });
  }
  saveState(projectPath, {
    ...next,
    lastRun: {
      runId: report.runId,
      at: new Date().toISOString(),
      proposals: report.proposals.length,
      costUsd: report.usage.costUsd,
      partial: report.partial,
    },
  });
}

function emptyReport(runId: string, projectPath: string, dryRun: boolean): RunReport {
  return {
    runId,
    projectPath,
    sessionsSelected: 0,
    sessionsAnalyzed: [],
    sessionsFailed: [],
    findings: [],
    survivingFindings: [],
    proposals: [],
    usage: { costUsd: 0 },
    partial: false,
    dryRun,
  };
}
