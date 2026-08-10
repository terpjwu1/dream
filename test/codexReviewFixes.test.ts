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
});
