import type { AgentRunner } from "../agents/runner.js";
import { AGGREGATOR_SYSTEM, aggregatorPrompt } from "../agents/prompts.js";
import type { Config } from "../config.js";
import { patternKey, type Candidate } from "../state.js";
import {
  AggregatedFindingArraySchema,
  type AggregatedFinding,
  type CandidateDraft,
  type Finding,
  type LedgerDelta,
} from "../types.js";
import type { RunBudget } from "./budget.js";

/**
 * Merge same-pattern findings via a single agent call, candidate-aware: the
 * agent sees stored (unproven) candidates and may PROPOSE that a current
 * finding matches one via matchedPatternKey. Invocation rule (Codex plan
 * revision #5): run whenever there is ≥1 current finding and ≥2 total
 * mergeable items — a single current finding must still get the chance to
 * match a stored candidate. Zero current findings skips entirely (the
 * fresh-evidence rule makes candidate-only promotion impossible anyway).
 */
export async function aggregateFindings(
  findings: Finding[],
  candidates: Candidate[],
  runner: AgentRunner,
  config: Config,
  budget: RunBudget,
): Promise<AggregatedFinding[]> {
  if (findings.length === 0 || !budget.canLaunch()) return findings;
  if (findings.length + candidates.length < 2) return findings;
  const { value, usage } = await runner.runJson({
    prompt: aggregatorPrompt(findings, candidates),
    systemPrompt: AGGREGATOR_SYSTEM,
    runtime: {
      provider: config.runtime.provider,
      model: config.runtime.model,
      maxSteps: 3,
    },
    workspace: { kind: "inline" },
    schema: AggregatedFindingArraySchema,
    label: "aggregator",
  });
  budget.record(usage);
  return value;
}

export interface PrevalenceResult {
  surviving: AggregatedFinding[];
  rejected: { finding: AggregatedFinding; reason: string; currentValidIds: string[] }[];
  /** Candidate keys legitimately referenced this run (promoted or not). */
  matchedKeys: string[];
  /** Candidate keys whose findings survived — promoted to proposals. */
  promotedKeys: string[];
}

/**
 * Deterministic prevalence gate — the harness arithmetic the talk prescribes,
 * now candidate-aware (all Codex-specified guardrails live here):
 * - current citations are validated against THIS run's analyzed set;
 * - for an agent-claimed candidate match, evidence = stored validated ids
 *   (immutable, quotes verbatim from state) ∪ newly validated ids;
 * - honest denominator: |storedValidated ∪ currentAnalyzed| (set union);
 * - fresh-evidence rule: a matched candidate can only survive with ≥1
 *   validated citation from the CURRENT run — no promotion by aging.
 */
export function applyPrevalence(
  findings: AggregatedFinding[],
  analyzedSessionIds: string[],
  config: Config,
  candidatesByKey: Record<string, Candidate> = {},
): PrevalenceResult {
  const analyzed = new Set(analyzedSessionIds);
  const result: PrevalenceResult = { surviving: [], rejected: [], matchedKeys: [], promotedKeys: [] };

  for (const finding of findings) {
    const candidate = finding.matchedPatternKey
      ? candidatesByKey[finding.matchedPatternKey]
      : undefined;
    if (candidate) result.matchedKeys.push(candidate.patternKey);

    const currentValidIds = [
      ...new Set(finding.evidence.sessionIds.filter((id) => analyzed.has(id))),
    ];
    const currentQuotes = finding.evidence.quotes.filter((q) => analyzed.has(q.sessionId));

    const evidenceIds = candidate
      ? [
          ...candidate.validatedSessionIds,
          ...currentValidIds.filter((id) => !candidate.validatedSessionIds.includes(id)),
        ]
      : currentValidIds;
    // Stored quotes are taken verbatim from state — the agent cannot reword
    // them — and re-filtered against the evidence set, so a malformed state
    // entry can never leak an unverifiable quote into a promoted finding
    // (Codex review finding).
    const quotes = candidate
      ? [
          ...candidate.quotes.filter((q) => evidenceIds.includes(q.sessionId)),
          ...currentQuotes,
        ]
      : currentQuotes;
    const validationSet = candidate
      ? new Set([...candidate.validatedSessionIds, ...analyzedSessionIds])
      : new Set(analyzedSessionIds);

    const reject = (reason: string) =>
      result.rejected.push({ finding: cleaned(), reason, currentValidIds });
    const cleaned = (): AggregatedFinding => ({
      ...finding,
      evidence: { sessionIds: evidenceIds, sessionsAnalyzed: validationSet.size, quotes },
    });

    if (currentValidIds.length === 0 || quotes.length === 0) {
      reject("no verifiable session citations from this run");
      continue;
    }
    // One hard contradiction of an existing memory is actionable on its own.
    const minSessions = finding.category === "stale_memory" ? 1 : config.prevalence.minSessions;
    const fraction = evidenceIds.length / Math.max(1, validationSet.size);
    if (evidenceIds.length < minSessions) {
      reject(`seen in ${evidenceIds.length} session(s), need ${minSessions}`);
    } else if (fraction < config.prevalence.minFraction) {
      reject(`fraction ${fraction.toFixed(2)} below ${config.prevalence.minFraction}`);
    } else {
      result.surviving.push(cleaned());
      if (candidate) result.promotedKeys.push(candidate.patternKey);
    }
  }
  return result;
}

/** Build the run's pure LedgerDelta from the prevalence outcome. */
export function buildLedgerDelta(
  prevalence: PrevalenceResult,
  analyzedSessionIds: string[],
): LedgerDelta {
  const upserts: CandidateDraft[] = [];
  for (const { finding, currentValidIds } of prevalence.rejected) {
    // stale_memory promotes at floor 1, so a rejected one has no future as a
    // candidate; findings with zero validated current citations have nothing
    // verifiable to store.
    if (finding.category === "stale_memory" || currentValidIds.length === 0) continue;
    upserts.push({
      patternKey: finding.matchedPatternKey ?? patternKey(finding.summary),
      category: finding.category,
      summary: finding.summary,
      detail: finding.detail,
      sessionIds: currentValidIds,
      quotes: finding.evidence.quotes.filter((q) => currentValidIds.includes(q.sessionId)),
    });
  }
  return {
    upserts,
    matchedKeys: [...new Set(prevalence.matchedKeys)],
    promotedKeys: [...new Set(prevalence.promotedKeys)],
    hadAnalyzedSessions: analyzedSessionIds.length > 0,
  };
}
