import { describe, expect, it } from "vitest";
import { applyPrevalence } from "../src/pipeline/aggregate.js";
import { ConfigSchema } from "../src/config.js";
import type { Finding } from "../src/types.js";

const config = ConfigSchema.parse({ prevalence: { minSessions: 2, minFraction: 0 } });

function finding(id: string, sessionIds: string[], category: Finding["category"] = "recurring_failure"): Finding {
  return {
    id,
    category,
    summary: `finding ${id}`,
    detail: "detail",
    evidence: {
      sessionIds,
      sessionsAnalyzed: 0,
      quotes: sessionIds.map((s) => ({ sessionId: s, excerpt: `quote from ${s}` })),
    },
    relatedMemoryFiles: [],
  };
}

describe("applyPrevalence", () => {
  const analyzed = ["s1", "s2", "s3", "s4"];

  it("keeps findings meeting the session threshold", () => {
    const { surviving } = applyPrevalence([finding("a", ["s1", "s3"])], analyzed, config);
    expect(surviving).toHaveLength(1);
    expect(surviving[0]!.evidence.sessionsAnalyzed).toBe(4);
  });

  it("rejects single-session findings (non-stale categories)", () => {
    const { surviving, rejected } = applyPrevalence([finding("a", ["s1"])], analyzed, config);
    expect(surviving).toHaveLength(0);
    expect(rejected[0]!.reason).toContain("need 2");
  });

  it("lets stale_memory findings through with one session", () => {
    const { surviving } = applyPrevalence(
      [finding("a", ["s1"], "stale_memory")],
      analyzed,
      config,
    );
    expect(surviving).toHaveLength(1);
  });

  it("drops hallucinated session ids before counting", () => {
    const { surviving, rejected } = applyPrevalence(
      [finding("a", ["s1", "GHOST-1", "GHOST-2"])],
      analyzed,
      config,
    );
    expect(surviving).toHaveLength(0); // only s1 is real → below threshold
    expect(rejected[0]!.finding.evidence.sessionIds).toEqual(["s1"]);
  });

  it("rejects findings with zero verifiable citations", () => {
    const { rejected } = applyPrevalence([finding("a", ["GHOST"])], analyzed, config);
    expect(rejected[0]!.reason).toContain("no verifiable");
  });

  it("enforces minFraction when configured", () => {
    const strict = ConfigSchema.parse({ prevalence: { minSessions: 2, minFraction: 0.75 } });
    const { rejected } = applyPrevalence([finding("a", ["s1", "s2"])], analyzed, strict);
    expect(rejected[0]!.reason).toContain("fraction");
  });
});
