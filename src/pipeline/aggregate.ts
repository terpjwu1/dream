import type { AgentRunner } from "../agents/runner.js";
import { AGGREGATOR_SYSTEM, aggregatorPrompt } from "../agents/prompts.js";
import type { Config } from "../config.js";
import { FindingArraySchema, type Finding } from "../types.js";
import type { RunBudget } from "./budget.js";

/** Merge same-pattern findings via a single agent call (skipped when trivial). */
export async function aggregateFindings(
  findings: Finding[],
  runner: AgentRunner,
  config: Config,
  budget: RunBudget,
): Promise<Finding[]> {
  if (findings.length <= 1 || !budget.canLaunch()) return findings;
  const { value, usage } = await runner.runJson({
    prompt: aggregatorPrompt(findings),
    systemPrompt: AGGREGATOR_SYSTEM,
    runtime: {
      provider: config.runtime.provider,
      model: config.runtime.model,
      maxSteps: 3,
    },
    workspace: { kind: "inline" },
    schema: FindingArraySchema,
    label: "aggregator",
  });
  budget.record(usage);
  return value;
}

/**
 * Deterministic prevalence gate — the harness arithmetic the talk prescribes.
 * Cited sessions are validated against the set actually analyzed this run;
 * hallucinated ids are dropped before counting.
 */
export function applyPrevalence(
  findings: Finding[],
  analyzedSessionIds: string[],
  config: Config,
): { surviving: Finding[]; rejected: { finding: Finding; reason: string }[] } {
  const analyzed = new Set(analyzedSessionIds);
  const surviving: Finding[] = [];
  const rejected: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    const realIds = [...new Set(finding.evidence.sessionIds.filter((id) => analyzed.has(id)))];
    const realQuotes = finding.evidence.quotes.filter((q) => analyzed.has(q.sessionId));
    if (realIds.length === 0 || realQuotes.length === 0) {
      rejected.push({ finding, reason: "no verifiable session citations" });
      continue;
    }
    const cleaned: Finding = {
      ...finding,
      evidence: {
        sessionIds: realIds,
        sessionsAnalyzed: analyzedSessionIds.length,
        quotes: realQuotes,
      },
    };
    // One hard contradiction of an existing memory is actionable on its own.
    const minSessions = finding.category === "stale_memory" ? 1 : config.prevalence.minSessions;
    const fraction = realIds.length / Math.max(1, analyzedSessionIds.length);
    if (realIds.length < minSessions) {
      rejected.push({
        finding: cleaned,
        reason: `seen in ${realIds.length} session(s), need ${minSessions}`,
      });
    } else if (fraction < config.prevalence.minFraction) {
      rejected.push({
        finding: cleaned,
        reason: `fraction ${fraction.toFixed(2)} below ${config.prevalence.minFraction}`,
      });
    } else {
      surviving.push(cleaned);
    }
  }
  return { surviving, rejected };
}
