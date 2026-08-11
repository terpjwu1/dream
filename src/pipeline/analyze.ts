import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunner } from "../agents/runner.js";
import { ANALYZER_SYSTEM, analyzerPrompt } from "../agents/prompts.js";
import type { Config } from "../config.js";
import { FindingArraySchema, type Finding, type SessionDigest } from "../types.js";
import { RunBudget, mapWithConcurrency } from "./budget.js";

export interface Batch {
  index: number;
  digests: SessionDigest[];
  dir: string;
}

export interface AnalyzeOutcome {
  findings: Finding[];
  analyzedSessionIds: string[];
  failedSessionIds: string[];
  failedBatchErrors: string[];
  skippedForBudget: number;
}

/** Greedy-pack digests into batches bounded by session count and token budget. */
export function packBatches(
  digests: SessionDigest[],
  config: Config,
): SessionDigest[][] {
  const batches: SessionDigest[][] = [];
  let current: SessionDigest[] = [];
  let currentTokens = 0;
  for (const digest of digests) {
    const wouldOverflow =
      current.length >= config.budget.batchSizeSessions ||
      (current.length > 0 &&
        currentTokens + digest.approxTokens > config.budget.maxDigestTokensPerBatch);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(digest);
    currentTokens += digest.approxTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Write one batch's staging dir: session digests + memory snapshot + steering. */
export function stageBatch(
  runDir: string,
  index: number,
  digests: SessionDigest[],
  memorySnapshot: string,
  steering: string,
): Batch {
  const dir = join(runDir, `batch-${index}`);
  mkdirSync(dir, { recursive: true });
  for (const digest of digests) {
    writeFileSync(join(dir, `session-${digest.sessionId.slice(0, 8)}.md`), digest.markdown);
  }
  writeFileSync(join(dir, "memory-snapshot.md"), memorySnapshot);
  writeFileSync(join(dir, "steering.md"), steering);
  return { index, digests, dir };
}

/** Fan analyzer agents out over batches with bounded concurrency + budget gate. */
export async function analyzeBatches(
  batches: Batch[],
  runner: AgentRunner,
  config: Config,
  budget: RunBudget,
): Promise<AnalyzeOutcome> {
  const outcome: AnalyzeOutcome = {
    findings: [],
    analyzedSessionIds: [],
    failedSessionIds: [],
    failedBatchErrors: [],
    skippedForBudget: 0,
  };

  await mapWithConcurrency(batches, config.budget.maxConcurrentAnalyzers, async (batch) => {
    const sessionIds = batch.digests.map((d) => d.sessionId);
    if (!budget.canLaunch()) {
      outcome.skippedForBudget++;
      outcome.failedSessionIds.push(...sessionIds);
      return;
    }
    try {
      const { value, usage } = await runner.runJson({
        prompt: analyzerPrompt(sessionIds),
        systemPrompt: ANALYZER_SYSTEM,
        runtime: {
          provider: config.analyzerRuntime.provider,
          model: config.analyzerRuntime.model,
          maxSteps: config.budget.maxStepsPerAgent,
        },
        workspace: { kind: "mountedDir", dir: batch.dir },
        schema: FindingArraySchema,
        label: `analyzer-batch${batch.index}`,
      });
      budget.record(usage);
      outcome.findings.push(...value);
      outcome.analyzedSessionIds.push(...sessionIds);
    } catch (err: unknown) {
      outcome.failedSessionIds.push(...sessionIds);
      outcome.failedBatchErrors.push(
        `batch ${batch.index} (${sessionIds.map((s) => s.slice(0, 8)).join(",")}): ${(err as Error).message}`,
      );
    }
  });

  return outcome;
}
