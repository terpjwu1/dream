import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyBranchMode } from "../src/output/branchMode.js";
import { applyAutoMode } from "../src/output/autoMode.js";
import { ConfigSchema } from "../src/config.js";
import type { Finding, Proposal, RunReport } from "../src/types.js";

const tmp = mkdtempSync(join(tmpdir(), "dream-out-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  sh(dir, "init", "-b", "main");
  sh(dir, "config", "user.email", "test@test");
  sh(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "MEMORY.md"), "# Memory Index\n");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-m", "init");
}

const finding: Finding = {
  id: "deploy-env",
  category: "recurring_failure",
  summary: "deploy fails without AWS_REGION",
  detail: "d",
  evidence: {
    sessionIds: ["s1", "s2"],
    sessionsAnalyzed: 4,
    quotes: [{ sessionId: "s1", excerpt: "MISSING_ENV_VAR AWS_REGION" }],
  },
  relatedMemoryFiles: [],
};

const CONTENT = `---
name: deploy-env
description: AWS_REGION must be exported before deploying
metadata:
  type: project
  curatedBy: dream
---

Export AWS_REGION before running deploy.sh.
`;

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return { op: "create", path: "deploy-env.md", newContent: CONTENT, rationale: "seen in 2 sessions", finding, ...overrides };
}

function report(proposals: Proposal[]): RunReport {
  return {
    runId: "2026-08-09-abc123",
    projectPath: "/fake/project",
    sessionsSelected: 4,
    sessionsAnalyzed: ["s1", "s2", "s3", "s4"],
    sessionsFailed: [],
    findings: [finding],
    survivingFindings: [finding],
    proposals,
    usage: { costUsd: 0.5 },
    partial: false,
    dryRun: false,
  };
}

describe("applyBranchMode", () => {
  let dir: string;
  let config: ReturnType<typeof ConfigSchema.parse>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmp, "branch-"));
    initRepo(dir);
    config = ConfigSchema.parse({ memory: { dir } });
  });

  it("creates one evidence commit per proposal on a dream branch and returns to main", async () => {
    await applyBranchMode("/fake/project", config, report([proposal()]));

    expect(sh(dir, "symbolic-ref", "--short", "HEAD")).toBe("main");
    const branches = sh(dir, "branch", "--list", "dream/*");
    expect(branches).toContain("dream/2026-08-09-abc123");

    const log = sh(dir, "log", "main..dream/2026-08-09-abc123", "--format=%s%n%b");
    expect(log).toContain("dream(create): deploy-env");
    expect(log).toContain("Pattern seen in 2/4 analyzed sessions");
    expect(log).toContain('Evidence: session s1 — "MISSING_ENV_VAR AWS_REGION"');
    expect(log).toContain("dream: regenerate MEMORY.md index");

    // main untouched
    expect(existsSync(join(dir, "deploy-env.md"))).toBe(false);
  });

  it("refuses a dirty tree", async () => {
    writeFileSync(join(dir, "MEMORY.md"), "dirty");
    await expect(applyBranchMode("/f", config, report([proposal()]))).rejects.toThrow(/uncommitted/);
  });

  it("refuses detached HEAD", async () => {
    sh(dir, "checkout", "--detach");
    await expect(applyBranchMode("/f", config, report([proposal()]))).rejects.toThrow(/detached/);
  });

  it("refuses a non-repo", async () => {
    const plain = mkdtempSync(join(tmp, "plain-"));
    const cfg = ConfigSchema.parse({ memory: { dir: plain } });
    await expect(applyBranchMode("/f", cfg, report([proposal()]))).rejects.toThrow(/dream init/);
  });
});

describe("applyAutoMode", () => {
  it("applies proposals, regenerates the index, and writes a revertable changelog", async () => {
    const dir = mkdtempSync(join(tmp, "auto-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stale.md"), "---\nname: stale\ndescription: old\n---\n\nold body\n");
    const config = ConfigSchema.parse({ memory: { dir } });

    const proposals = [
      proposal(),
      proposal({
        op: "update",
        path: "stale.md",
        newContent: "---\nname: stale\ndescription: refreshed\n---\n\nnew body\n",
      }),
    ];
    await applyAutoMode("/fake/project", config, report(proposals));

    expect(readFileSync(join(dir, "deploy-env.md"), "utf8")).toContain("AWS_REGION");
    expect(readFileSync(join(dir, "stale.md"), "utf8")).toContain("new body");

    const changelog = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("run 2026-08-09-abc123 (auto)");
    expect(changelog).toContain("### create deploy-env.md");
    expect(changelog).toContain("Prevalence: 2/4 sessions");
    expect(changelog).toContain("old body"); // prior content preserved for revert

    const index = readFileSync(join(dir, "MEMORY.md"), "utf8");
    expect(index).toContain("[deploy-env](deploy-env.md)");
  });
});
