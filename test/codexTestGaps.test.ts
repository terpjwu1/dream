import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// ---- SDK option conformance (Codex round-1 test-gap: mock query, assert options)

const captured: { prompt?: string; options?: Record<string, unknown> } = {};
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (params: { prompt: string; options?: Record<string, unknown> }) => {
    captured.prompt = params.prompt;
    captured.options = params.options;
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: '```json\n[]\n```',
        total_cost_usd: 0.01,
        modelUsage: { "claude-fable-5": { inputTokens: 10, outputTokens: 5 } },
      };
    })();
  },
}));

import { ClaudeAgentRunner } from "../src/agents/claudeRunner.js";
import { FindingArraySchema } from "../src/types.js";
import { applyBranchMode } from "../src/output/branchMode.js";
import { runPipeline } from "../src/pipeline/run.js";
import { ClaudeCodeSource } from "../src/sources/claudeCode.js";
import { ConfigSchema } from "../src/config.js";
import { runsDir } from "../src/paths.js";
import type { AgentRunner, RunJsonRequest, RunJsonResult } from "../src/agents/runner.js";
import type { RunReport, SessionRef } from "../src/types.js";

const tmp = mkdtempSync(join(tmpdir(), "dream-gaps-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("ClaudeAgentRunner SDK option conformance", () => {
  it("passes the exact sandbox options for a mounted workspace", async () => {
    const runner = new ClaudeAgentRunner();
    const result = await runner.runJson({
      prompt: "p",
      systemPrompt: "s",
      runtime: { provider: "claude-agent-sdk", model: "claude-fable-5", maxSteps: 7 },
      workspace: { kind: "mountedDir", dir: tmp },
      schema: FindingArraySchema,
      label: "conformance",
    });

    expect(captured.options).toMatchObject({
      model: "claude-fable-5",
      systemPrompt: "s",
      cwd: tmp,
      tools: ["Read", "Grep", "Glob"],          // RESTRICTS availability
      allowedTools: ["Read", "Grep", "Glob"],   // auto-approves within that set
      permissionMode: "dontAsk",
      maxTurns: 7,
      settingSources: [],                        // no user CLAUDE.md/hooks
    });
    expect(result.usage.inputTokens).toBe(10);   // from modelUsage, not usage
    expect(result.value).toEqual([]);
  });

  it("passes an empty tool surface for inline workspaces", async () => {
    const runner = new ClaudeAgentRunner();
    await runner.runJson({
      prompt: "p",
      systemPrompt: "s",
      runtime: { provider: "claude-agent-sdk", model: "claude-fable-5" },
      workspace: { kind: "inline", inlineDocs: [{ name: "d", content: "c" }] },
      schema: FindingArraySchema,
    });
    expect(captured.options).toMatchObject({ tools: [], allowedTools: [], cwd: undefined });
    expect(captured.prompt).toContain('<document name="d">');
  });
});

// ---- Mid-commit failure rollback (Codex round-1 test-gap: failing pre-commit hook)

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
}

describe("branch mode mid-commit failure", () => {
  it("leaves the base branch checked out and clean when a commit fails", async () => {
    const dir = join(tmp, "hook-repo");
    mkdirSync(dir, { recursive: true });
    sh(dir, "init", "-b", "main");
    sh(dir, "config", "user.email", "t@t");
    sh(dir, "config", "user.name", "T");
    writeFileSync(join(dir, "MEMORY.md"), "# Memory Index\n");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-m", "init");
    const hook = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);

    const config = ConfigSchema.parse({ memory: { dir } });
    const report = {
      runId: "hookfail",
      proposals: [
        {
          op: "create",
          path: "x.md",
          newContent: "---\nname: x\ndescription: d\n---\n\nbody\n",
          rationale: "r",
          finding: {
            id: "f",
            category: "recurring_failure",
            summary: "s",
            detail: "d",
            evidence: { sessionIds: ["a"], sessionsAnalyzed: 1, quotes: [{ sessionId: "a", excerpt: "q" }] },
            relatedMemoryFiles: [],
          },
        },
      ],
    } as unknown as RunReport;

    await expect(applyBranchMode("/p", config, report)).rejects.toThrow();
    expect(sh(dir, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(sh(dir, "status", "--porcelain")).toBe(""); // nothing staged carried back
  });
});

// ---- Whole-report secret assertion (Codex round-1 test-gap)

class LeakyRunner implements AgentRunner {
  readonly capabilities = { toolUse: false, jsonSchema: true, parallel: true, costMetering: true };
  async runJson<T>(req: RunJsonRequest<T>): Promise<RunJsonResult<T>> {
    // analyzer/aggregator emit a finding with secrets buried in several fields
    const finding = {
      id: "leak",
      category: "recurring_failure" as const,
      summary: "token ghp_" + "a1B2".repeat(10) + " appears",
      detail: "key sk-ant-api03-verysecret1234 was in output",
      evidence: {
        sessionIds: ["s1", "s2"],
        sessionsAnalyzed: 2,
        quotes: [
          { sessionId: "s1", excerpt: "AKIAIOSFODNN7EXAMPLE seen here" },
          { sessionId: "s2", excerpt: "AKIAIOSFODNN7EXAMPLE again" },
        ],
      },
      relatedMemoryFiles: [],
    };
    // analyzers/aggregator emit the leaky finding; the proposer proposes nothing
    const value = req.label?.startsWith("proposer") ? [] : [finding];
    return { value: req.schema.parse(value), raw: "[]", usage: { costUsd: 0.01 } };
  }
}

describe("report.json never contains secrets", () => {
  it("deep-redacts findings before persisting the run report", async () => {
    const ref: SessionRef = {
      sessionId: "s1",
      filePath: "/fake/s1.jsonl",
      startedAt: new Date("2026-08-01T00:00:00Z"),
      endedAt: new Date("2026-08-01T01:00:00Z"),
      sizeBytes: 10,
      projectPath: join(tmp, "leak-proj"),
    };
    vi.spyOn(ClaudeCodeSource.prototype, "listSessions").mockResolvedValue([
      ref,
      { ...ref, sessionId: "s2" },
    ]);
    vi.spyOn(ClaudeCodeSource.prototype, "readSession").mockImplementation(
      async function* () {
        yield { kind: "user_prompt", text: "hi", ts: "", uuid: "u" };
      } as never,
    );

    const config = ConfigSchema.parse({ memory: { dir: join(tmp, "leak-mem") } });
    mkdirSync(join(tmp, "leak-mem"), { recursive: true });
    const report = await runPipeline(
      join(tmp, "leak-proj"),
      config,
      new LeakyRunner(),
      { dryRun: true },
      () => {},
    );

    const persisted = readFileSync(join(runsDir(report.runId), "report.json"), "utf8");
    expect(persisted).not.toContain("ghp_");
    expect(persisted).not.toContain("sk-ant-");
    expect(persisted).not.toContain("AKIA");
    expect(persisted).toContain("[REDACTED-SECRET]");
    rmSync(runsDir(report.runId), { recursive: true, force: true });
  });
});
