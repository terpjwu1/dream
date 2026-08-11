import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acquireRunLock, loadState, saveState, StateSchema } from "../src/state.js";
import { commitWatermark } from "../src/pipeline/run.js";
import { FileMemoryStore } from "../src/memory/memoryStore.js";
import { extractJson } from "../src/agents/runner.js";
import { stateFile } from "../src/paths.js";
import type { RunReport } from "../src/types.js";

const tmp = mkdtempSync(join(tmpdir(), "dream-fixes-"));
// Use a project path that cannot collide with real state files.
const proj = join(tmp, "lock-proj");
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(stateFile(proj), { force: true });
  rmSync(`${stateFile(proj)}.lock`, { force: true });
});

describe("acquireRunLock", () => {
  it("blocks a second concurrent run and releases cleanly", () => {
    const release = acquireRunLock(proj);
    expect(() => acquireRunLock(proj)).toThrow(/another dream run/);
    release();
    const release2 = acquireRunLock(proj);
    release2();
  });
});

describe("commitWatermark", () => {
  it("merges with state written since the run began (no clobbering)", () => {
    saveState(proj, StateSchema.parse({
      dreamedSessions: { other: { at: "x", runId: "other-run", status: "analyzed" } },
    }));
    const report = {
      runId: "r2",
      projectPath: proj,
      sessionsAnalyzed: ["mine"],
      sessionsFailed: [],
      proposals: [],
      usage: { costUsd: 1 },
      partial: false,
      dryRun: false,
    } as unknown as RunReport;
    commitWatermark(proj, report);
    const state = loadState(proj);
    expect(Object.keys(state.dreamedSessions).sort()).toEqual(["mine", "other"]);
  });

  it("never advances on dry runs", () => {
    const before = loadState(proj);
    commitWatermark(proj, { dryRun: true, sessionsAnalyzed: ["dry"] } as unknown as RunReport);
    expect(loadState(proj)).toEqual(before);
  });
});

describe("symlink escape protection", () => {
  it("rejects proposals targeting symlinks inside the store", () => {
    const memDir = join(tmp, "memory");
    const outside = join(tmp, "outside");
    mkdirSync(memDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "victim.md"), "outside content");
    symlinkSync(join(outside, "victim.md"), join(memDir, "sneaky.md"));
    symlinkSync(outside, join(memDir, "sneakydir"));

    const store = new FileMemoryStore(memDir);
    expect(() => store.resolvePath("sneaky.md")).toThrow(/symlink/);
    expect(() => store.resolvePath("sneakydir/victim.md")).toThrow(/symlink/);
    expect(() => store.resolvePath("fine.md")).not.toThrow();
  });
});

describe("extractJson with early prose brackets", () => {
  it("skips a bracket in prose and finds the later valid document", () => {
    const text = 'As noted [above], the result {here} is:\n[{"op":"create","path":"a.md"}]';
    expect(JSON.parse(extractJson(text))).toEqual([{ op: "create", path: "a.md" }]);
  });

  it("prefers the LAST outermost document when earlier prose contains valid JSON", () => {
    const text = 'Config was {"debug": true} at start.\nFinal answer:\n[{"op":"delete","path":"b.md"}]';
    expect(JSON.parse(extractJson(text))).toEqual([{ op: "delete", path: "b.md" }]);
  });

  it("still prefers the outermost document over its own nested fragments", () => {
    expect(extractJson('Here you go: [{"a":1}]')).toBe('[{"a":1}]');
  });
});

describe("round-2 verification fixes", () => {
  it("release only removes a lock it owns", async () => {
    const proj2 = join(tmp, "lock-proj-2");
    const release = acquireRunLock(proj2);
    const lockPath = `${stateFile(proj2)}.lock`;
    writeFileSync(lockPath, "someone-else\n"); // another run took over
    release(); // must NOT delete the other owner's lock
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(lockPath, "utf8")).toBe("someone-else\n");
    rmSync(lockPath, { force: true });
    rmSync(stateFile(proj2), { force: true });
  });

  it("deep-redacts secrets in ANY finding field, not just known ones", async () => {
    const { redactFinding } = await import("../src/pipeline/propose.js");
    const finding = {
      id: "ghp_" + "a1B2".repeat(10),
      category: "recurring_failure",
      summary: "s",
      detail: "d",
      evidence: {
        sessionIds: ["sk-ant-api03-leakyleaky42"],
        sessionsAnalyzed: 1,
        quotes: [{ sessionId: "s1", excerpt: "q" }],
      },
      relatedMemoryFiles: ["AKIAIOSFODNN7EXAMPLE.md"],
    } as never;
    const redacted = JSON.stringify(redactFinding(finding));
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("sk-ant-");
    expect(redacted).not.toContain("AKIA");
  });

  it("write refuses to follow a symlink even past the resolve check (O_NOFOLLOW)", async () => {
    const memDir = join(tmp, "memory-nofollow");
    const outside = join(tmp, "outside-nofollow");
    mkdirSync(memDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "victim.md"), "original");
    const store = new FileMemoryStore(memDir);
    // Simulate the TOCTOU: symlink appears AFTER resolvePath would have run.
    symlinkSync(join(outside, "victim.md"), join(memDir, "raced.md"));
    await expect(
      // call apply's write path directly with a pre-resolved-looking proposal
      store.apply({
        op: "update",
        path: "raced.md",
        newContent: "attacker content",
        rationale: "r",
        finding: {} as never,
      }),
    ).rejects.toThrow();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(outside, "victim.md"), "utf8")).toBe("original");
  });
});
