import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type {
  AgentRunner,
  RunJsonRequest,
  RunJsonResult,
  RunnerCapabilities,
} from "../src/agents/runner.js";
import { ConfigSchema } from "../src/config.js";
import { RunBudget } from "../src/pipeline/budget.js";
import { analyzeBatches, packBatches, stageBatch } from "../src/pipeline/analyze.js";
import { generateProposals, normalizeProposalPath } from "../src/pipeline/propose.js";
import { FileMemoryStore } from "../src/memory/memoryStore.js";
import type { Finding, SessionDigest } from "../src/types.js";

const tmp = mkdtempSync(join(tmpdir(), "dream-pipe-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function digest(sessionId: string, tokens = 1000): SessionDigest {
  return {
    sessionId,
    startedAt: "2026-08-01T10:00:00Z",
    endedAt: "2026-08-01T11:00:00Z",
    models: ["claude-fable-5"],
    stats: { userTurns: 1, toolCalls: 1, toolErrors: 1, interrupted: 0 },
    markdown: `# Session ${sessionId}\ncontent`,
    approxTokens: tokens,
  };
}

const FINDING: Finding = {
  id: "deploy-env",
  category: "recurring_failure",
  summary: "deploy fails without AWS_REGION",
  detail: "detail",
  evidence: {
    sessionIds: ["s1", "s2"],
    sessionsAnalyzed: 2,
    quotes: [{ sessionId: "s1", excerpt: "MISSING_ENV_VAR AWS_REGION" }],
  },
  relatedMemoryFiles: [],
};

class FakeRunner implements AgentRunner {
  readonly capabilities: RunnerCapabilities = {
    toolUse: false,
    jsonSchema: true,
    parallel: true,
    costMetering: true,
  };
  calls: RunJsonRequest<unknown>[] = [];
  constructor(private responses: unknown[], private costPerCall = 0.05) {}
  async runJson<T>(req: RunJsonRequest<T>): Promise<RunJsonResult<T>> {
    this.calls.push(req as RunJsonRequest<unknown>);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return {
      value: req.schema.parse(next),
      raw: JSON.stringify(next),
      usage: { costUsd: this.costPerCall, inputTokens: 100, outputTokens: 50 },
    };
  }
}

describe("packBatches", () => {
  const config = ConfigSchema.parse({
    budget: { batchSizeSessions: 2, maxDigestTokensPerBatch: 3000 },
  });

  it("splits on session count and token budget", () => {
    const batches = packBatches(
      [digest("a", 1000), digest("b", 1000), digest("c", 2500), digest("d", 100)],
      config,
    );
    expect(batches.map((b) => b.map((d) => d.sessionId))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("never strands an oversized session", () => {
    const batches = packBatches([digest("huge", 99999)], config);
    expect(batches).toHaveLength(1);
  });
});

describe("analyzeBatches", () => {
  const config = ConfigSchema.parse({});

  it("collects findings and tracks failed batches without marking their sessions analyzed", async () => {
    const runDir = join(tmp, "run1");
    mkdirSync(runDir, { recursive: true });
    const batches = [
      stageBatch(runDir, 0, [digest("s1"), digest("s2")], "# memory", "steer"),
      stageBatch(runDir, 1, [digest("s3")], "# memory", "steer"),
    ];
    expect(existsSync(join(runDir, "batch-0", "session-s1.md"))).toBe(true);
    expect(existsSync(join(runDir, "batch-0", "steering.md"))).toBe(true);

    const runner = new FakeRunner([[FINDING], new Error("model exploded")]);
    const budget = new RunBudget(5);
    const outcome = await analyzeBatches(batches, runner, config, budget);

    expect(outcome.findings).toHaveLength(1);
    expect(outcome.analyzedSessionIds).toEqual(["s1", "s2"]);
    expect(outcome.failedSessionIds).toEqual(["s3"]);
    expect(outcome.failedBatchErrors[0]).toContain("model exploded");
  });

  it("stops launching batches once the budget is crossed", async () => {
    const runDir = join(tmp, "run2");
    const batches = [
      stageBatch(runDir, 0, [digest("s1")], "m", "s"),
      stageBatch(runDir, 1, [digest("s2")], "m", "s"),
      stageBatch(runDir, 2, [digest("s3")], "m", "s"),
    ];
    const config1 = ConfigSchema.parse({ budget: { maxConcurrentAnalyzers: 1 } });
    const runner = new FakeRunner([[], [], []], 10); // each call costs $10 > $5 cap
    const budget = new RunBudget(5);
    const outcome = await analyzeBatches(batches, runner, config1, budget);

    expect(runner.calls).toHaveLength(1); // first launch allowed, then gated
    expect(outcome.skippedForBudget).toBe(2);
    expect(budget.wasAborted()).toBe(true);
  });
});

describe("normalizeProposalPath", () => {
  it("strips the store-dir prefix agents add from their cwd view", () => {
    expect(normalizeProposalPath("memory/db-setup.md", "/x/memory")).toBe("db-setup.md");
    expect(normalizeProposalPath("./db-setup.md", "/x/memory")).toBe("db-setup.md");
    expect(normalizeProposalPath("db-setup.md", "/x/memory")).toBe("db-setup.md");
    // only the store's own basename is stripped, nothing else
    expect(normalizeProposalPath("sub/db.md", "/x/memory")).toBe("sub/db.md");
  });
});

describe("generateProposals", () => {
  const config = ConfigSchema.parse({});

  it("validates paths, targets, frontmatter, and redacts secrets end-to-end", async () => {
    const memDir = join(tmp, "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(
      join(memDir, "existing.md"),
      "---\nname: existing\ndescription: d\n---\n\nbody\n",
    );
    const store = new FileMemoryStore(memDir);
    const goodContent =
      "---\nname: deploy-env\ndescription: AWS_REGION must be set (token ghp_" +
      "a1B2".repeat(10) +
      ")\n---\n\nExport AWS_REGION before deploying.\n";

    const runner = new FakeRunner([
      [
        { op: "create", path: "deploy-env.md", newContent: goodContent, rationale: "seen twice", findingId: "deploy-env" },
        { op: "create", path: "../escape.md", newContent: goodContent, rationale: "r", findingId: "deploy-env" },
        { op: "update", path: "missing.md", newContent: goodContent, rationale: "r", findingId: "deploy-env" },
        { op: "create", path: "existing.md", newContent: goodContent, rationale: "r", findingId: "deploy-env" },
        { op: "create", path: "bad-fm.md", newContent: "no frontmatter", rationale: "r", findingId: "deploy-env" },
        { op: "create", path: "ghost.md", newContent: goodContent, rationale: "r", findingId: "nope" },
        { op: "update", path: "MEMORY.md", newContent: goodContent, rationale: "r", findingId: "deploy-env" },
      ],
    ]);
    const budget = new RunBudget(5);
    const { proposals, invalid } = await generateProposals(
      [FINDING],
      store,
      runner,
      config,
      budget,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.path).toBe("deploy-env.md");
    expect(proposals[0]!.newContent).toContain("[REDACTED-SECRET]");
    expect(proposals[0]!.newContent).not.toContain("ghp_");

    const reasons = invalid.map((i) => `${i.path}: ${i.reason}`).join("\n");
    expect(reasons).toContain("escape.md: Proposal path escapes");
    expect(reasons).toContain("missing.md: update target does not exist");
    expect(reasons).toContain("existing.md: create target already exists");
    expect(reasons).toContain("bad-fm.md: Frontmatter must include");
    expect(reasons).toContain('ghost.md: references unknown finding "nope"');
    expect(reasons).toContain("MEMORY.md: reserved file");
  });
});
