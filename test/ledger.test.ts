import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import {
  applyLedgerDelta,
  patternKey,
  pruneCandidates,
  StateSchema,
  type Candidate,
} from "../src/state.js";
import { applyPrevalence, buildLedgerDelta } from "../src/pipeline/aggregate.js";
import { FindingArraySchema, type AggregatedFinding, type LedgerDelta } from "../src/types.js";

const config = ConfigSchema.parse({ prevalence: { minSessions: 2, minFraction: 0 } });
const LIMITS = { sinceDays: 14, maxPerCategory: 20, maxMissedRuns: 5 };
const NOW = new Date("2026-08-11T12:00:00Z");

function finding(
  sessionIds: string[],
  overrides: Partial<AggregatedFinding> = {},
): AggregatedFinding {
  return {
    id: "f1",
    category: "recurring_failure",
    summary: "tests flake on ARM runners",
    detail: "detail",
    evidence: {
      sessionIds,
      sessionsAnalyzed: 0,
      quotes: sessionIds.map((s) => ({ sessionId: s, excerpt: `quote from ${s}` })),
    },
    relatedMemoryFiles: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    patternKey: patternKey("tests flake on ARM runners"),
    category: "recurring_failure",
    summary: "tests flake on ARM runners",
    detail: "detail",
    validatedSessionIds: ["s1"],
    quotes: [{ sessionId: "s1", excerpt: "ORIGINAL stored quote" }],
    firstSeenAt: "2026-08-10T00:00:00Z",
    lastSeenAt: "2026-08-10T00:00:00Z",
    missedRuns: 0,
    ...overrides,
  };
}

describe("patternKey", () => {
  it("is a full sha256 hex, stable under digits/paths/case variation", () => {
    const a = patternKey("Failed 3 times in /Users/x/proj/a.ts");
    const b = patternKey("failed 17 times in /tmp/other/b.ts");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(patternKey("a completely different pattern")).not.toBe(a);
  });
});

describe("cross-run promotion (the session-continuity core)", () => {
  it("run 1 holds a single-session pattern; run 2 promotes it citing both sessions", () => {
    // Run 1: pattern seen in s1 only → rejected → held as candidate.
    const run1 = applyPrevalence([finding(["s1"])], ["s1"], config, {});
    expect(run1.surviving).toHaveLength(0);
    const delta1 = buildLedgerDelta(run1, ["s1"]);
    expect(delta1.upserts).toHaveLength(1);
    let state = StateSchema.parse({});
    state = applyLedgerDelta(state, delta1, LIMITS, NOW);
    const key = delta1.upserts[0]!.patternKey;
    expect(state.candidates[key]!.validatedSessionIds).toEqual(["s1"]);

    // Run 2: same pattern in s2; aggregator matched it to the candidate.
    const run2 = applyPrevalence(
      [finding(["s2"], { matchedPatternKey: key })],
      ["s2"],
      config,
      state.candidates,
    );
    expect(run2.surviving).toHaveLength(1);
    const promoted = run2.surviving[0]!;
    expect(promoted.evidence.sessionIds.sort()).toEqual(["s1", "s2"]);
    expect(promoted.evidence.sessionsAnalyzed).toBe(2); // |{s1} ∪ {s2}|
    // run 1's stored quote carries into the proposal via state (the run-2
    // finding only cited s2 — s1's quote can only have come from the ledger)
    expect(promoted.evidence.quotes.map((q) => q.excerpt)).toContain("quote from s1");
    // promotion deletes the candidate
    const delta2 = buildLedgerDelta(run2, ["s2"]);
    expect(delta2.promotedKeys).toEqual([key]);
    state = applyLedgerDelta(state, delta2, LIMITS, NOW);
    expect(state.candidates[key]).toBeUndefined();
  });

  it("denominator uses set-union cardinality when sessions overlap (no double count)", () => {
    const cand = candidate({ validatedSessionIds: ["s1", "s2"] });
    // s2 is BOTH previously validated and re-analyzed this run.
    const result = applyPrevalence(
      [finding(["s2", "s3"], { matchedPatternKey: cand.patternKey })],
      ["s2", "s3"],
      config,
      { [cand.patternKey]: cand },
    );
    const f = result.surviving[0]!;
    expect(f.evidence.sessionIds.sort()).toEqual(["s1", "s2", "s3"]); // union, s2 once
    expect(f.evidence.sessionsAnalyzed).toBe(3); // |{s1,s2} ∪ {s2,s3}| = 3, not 4
  });

  it("fresh-evidence rule: a matched candidate with zero current citations cannot promote", () => {
    const cand = candidate({ validatedSessionIds: ["s1", "s2"] }); // would pass minSessions alone
    const result = applyPrevalence(
      [finding(["GHOST"], { matchedPatternKey: cand.patternKey })],
      ["s9"],
      config,
      { [cand.patternKey]: cand },
    );
    expect(result.surviving).toHaveLength(0);
    expect(result.rejected[0]!.reason).toContain("from this run");
  });

  it("hallucinated matchedPatternKey (unknown candidate) is treated as unmatched", () => {
    const result = applyPrevalence(
      [finding(["s1"], { matchedPatternKey: "deadbeef".repeat(8) })],
      ["s1"],
      config,
      {},
    );
    expect(result.matchedKeys).toEqual([]);
    expect(result.surviving).toHaveLength(0); // 1 session < 2, no candidate boost
  });

  it("analyzers cannot smuggle matchedPatternKey (schema strips it)", () => {
    const smuggled = [{ ...finding(["s1"]), matchedPatternKey: "x".repeat(64) }];
    const parsed = FindingArraySchema.parse(smuggled);
    expect((parsed[0] as Record<string, unknown>).matchedPatternKey).toBeUndefined();
  });
});

describe("applyLedgerDelta aging and pruning", () => {
  const emptyDelta = (had: boolean): LedgerDelta => ({
    upserts: [],
    matchedKeys: [],
    promotedKeys: [],
    hadAnalyzedSessions: had,
  });

  it("hallucinated candidates expire via missedRuns — but zero-analyzed runs never age them", () => {
    const cand = candidate();
    let state = StateSchema.parse({ candidates: { [cand.patternKey]: cand } });
    // zero-analyzed runs: no aging, forever
    for (let i = 0; i < 10; i++) state = applyLedgerDelta(state, emptyDelta(false), LIMITS, NOW);
    expect(state.candidates[cand.patternKey]!.missedRuns).toBe(0);
    // committed analyzed runs: ages by one each, dies past maxMissedRuns
    for (let i = 0; i <= LIMITS.maxMissedRuns; i++) {
      state = applyLedgerDelta(state, emptyDelta(true), LIMITS, NOW);
    }
    expect(state.candidates[cand.patternKey]).toBeUndefined();
  });

  it("a matched candidate does not age even when its finding failed prevalence again", () => {
    const cand = candidate();
    let state = StateSchema.parse({ candidates: { [cand.patternKey]: cand } });
    state = applyLedgerDelta(
      state,
      { upserts: [], matchedKeys: [cand.patternKey], promotedKeys: [], hadAnalyzedSessions: true },
      LIMITS,
      NOW,
    );
    expect(state.candidates[cand.patternKey]!.missedRuns).toBe(0);
  });

  it("TTL and per-category cap prune", () => {
    const old = candidate({ lastSeenAt: "2026-07-01T00:00:00Z" }); // > 14d before NOW
    expect(pruneCandidates({ [old.patternKey]: old }, LIMITS, NOW)).toEqual({});

    const many: Record<string, Candidate> = {};
    for (let i = 0; i < 25; i++) {
      const c = candidate({
        patternKey: patternKey(`pattern variant ${"x".repeat(i + 1)}`),
        summary: `pattern variant ${"x".repeat(i + 1)}`,
        lastSeenAt: `2026-08-${String(1 + (i % 9)).padStart(2, "0")}T00:00:00Z`,
      });
      many[c.patternKey] = c;
    }
    const pruned = pruneCandidates(many, { ...LIMITS, sinceDays: 365 }, NOW);
    expect(Object.keys(pruned).length).toBe(LIMITS.maxPerCategory);
  });

  it("upsert merge is append-only with quote caps, and redacts secrets", () => {
    const cand = candidate();
    let state = StateSchema.parse({ candidates: { [cand.patternKey]: cand } });
    state = applyLedgerDelta(
      state,
      {
        upserts: [
          {
            patternKey: cand.patternKey,
            category: "recurring_failure",
            summary: "REWRITTEN summary the agent invented",
            detail: "d",
            sessionIds: ["s2"],
            quotes: [
              { sessionId: "s2", excerpt: "token ghp_" + "a1B2".repeat(10) + " leaked " + "y".repeat(400) },
            ],
          },
        ],
        matchedKeys: [cand.patternKey],
        promotedKeys: [],
        hadAnalyzedSessions: true,
      },
      LIMITS,
      NOW,
    );
    const merged = state.candidates[cand.patternKey]!;
    expect(merged.summary).toBe("tests flake on ARM runners"); // stored summary immutable
    expect(merged.validatedSessionIds).toEqual(["s1", "s2"]); // append-only
    expect(merged.quotes[0]!.excerpt).toBe("ORIGINAL stored quote"); // prior quote untouched
    const newQuote = merged.quotes.find((q) => q.sessionId === "s2")!;
    expect(newQuote.excerpt).not.toContain("ghp_"); // redacted
    expect(newQuote.excerpt.length).toBeLessThanOrEqual(240 + 20); // capped (redaction marker slack)
  });

  it("dry runs never touch the ledger (commitWatermark early-returns)", async () => {
    const { commitWatermark } = await import("../src/pipeline/run.js");
    // dryRun report with a delta — must be a no-op (no state file created)
    commitWatermark(
      "/tmp/dream-ledger-dry-test",
      {
        dryRun: true,
        sessionsAnalyzed: ["s1"],
        ledgerDelta: emptyDelta(true),
        proposals: [],
        usage: {},
      } as never,
      config,
    );
    const { existsSync } = await import("node:fs");
    const { stateFile } = await import("../src/paths.js");
    expect(existsSync(stateFile("/tmp/dream-ledger-dry-test"))).toBe(false);
  });
});
