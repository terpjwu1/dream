import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeCodeSource, mapRecord } from "../src/sources/claudeCode.js";
import { mungeProjectPath } from "../src/paths.js";
import type { SessionRecord } from "../src/types.js";
import { FIXTURE_JSONL, FIXTURE_LINES } from "./fixtures/session-fixture.js";

function mapAll(lines: object[]): SessionRecord[] {
  return lines.flatMap((l) => [...mapRecord(l)]);
}

describe("mungeProjectPath", () => {
  it("matches Claude Code's directory naming", () => {
    expect(mungeProjectPath("/Users/jwu/Documents/dream")).toBe("-Users-jwu-Documents-dream");
    expect(mungeProjectPath("/Users/jwu/Documents/buddyReborn/buddy")).toBe(
      "-Users-jwu-Documents-buddyReborn-buddy",
    );
    expect(mungeProjectPath("/a/b.c_d")).toBe("-a-b-c-d");
  });
});

describe("mapRecord", () => {
  const records = mapAll(FIXTURE_LINES);

  it("skips isMeta user records as prompts", () => {
    const prompts = records.filter((r) => r.kind === "user_prompt");
    expect(prompts).toHaveLength(1);
    expect((prompts[0] as any).text).toContain("flaky deploy script");
  });

  it("drops thinking blocks but keeps text and tool_use", () => {
    const texts = records.filter((r) => r.kind === "assistant_text");
    expect(texts).toHaveLength(1);
    expect((texts[0] as any).text).not.toContain("SHOULD BE DROPPED");
    const calls = records.filter((r) => r.kind === "tool_call");
    expect(calls).toHaveLength(2);
    expect((calls[0] as any).toolName).toBe("Bash");
  });

  it("captures tool errors with stderr from the toolUseResult side channel", () => {
    const results = records.filter((r) => r.kind === "tool_result");
    expect(results).toHaveLength(2);
    const err = results[0] as Extract<SessionRecord, { kind: "tool_result" }>;
    expect(err.isError).toBe(true);
    expect(err.stderr).toContain("MISSING_ENV_VAR");
  });

  it("captures user interruptions", () => {
    const interrupted = records.filter(
      (r) => r.kind === "tool_result" && r.interrupted,
    );
    expect(interrupted).toHaveLength(1);
  });

  it("maps unknown record types to meta", () => {
    const metas = records.filter((r) => r.kind === "meta");
    expect(metas.map((m) => (m as any).raw.type)).toEqual(
      expect.arrayContaining(["progress", "file-history-snapshot", "queue-operation"]),
    );
  });
});

describe("ClaudeCodeSource", () => {
  const fakeHome = mkdtempSync(join(tmpdir(), "dream-test-"));
  process.env.DREAM_TEST_HOME = fakeHome;

  afterAll(() => rmSync(fakeHome, { recursive: true, force: true }));

  it("lists and streams sessions from a project transcript dir", async () => {
    // listSessions resolves via the real homedir; simulate by writing into a
    // temp structure and reading the file through readSession directly.
    const dir = join(fakeHome, "projects", "-Users-test-proj");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
    writeFileSync(file, FIXTURE_JSONL);

    const source = new ClaudeCodeSource();
    const records: SessionRecord[] = [];
    for await (const r of source.readSession({
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      filePath: file,
      startedAt: new Date("2026-08-01T10:00:00Z"),
      endedAt: new Date("2026-08-01T10:01:05Z"),
      sizeBytes: FIXTURE_JSONL.length,
      projectPath: "/Users/test/proj",
    })) {
      records.push(r);
    }

    expect(records.some((r) => r.kind === "user_prompt")).toBe(true);
    const envelope = records.find((r) => r.kind === "meta" && r.raw.type === "envelope");
    expect((envelope as any)?.raw.gitBranch).toBe("feat/demo");
  });

  it("survives a torn final line (live session)", async () => {
    const dir = join(fakeHome, "projects", "-Users-test-proj2");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff.jsonl");
    writeFileSync(file, FIXTURE_JSONL + '{"type":"assistant","message":{"content":[{"ty');

    const source = new ClaudeCodeSource();
    const records: SessionRecord[] = [];
    for await (const r of source.readSession({
      sessionId: "aaaaaaaa-bbbb-cccc-dddd-ffffffffffff",
      filePath: file,
      startedAt: new Date(),
      endedAt: new Date(),
      sizeBytes: 1,
      projectPath: "/Users/test/proj2",
    })) {
      records.push(r);
    }
    expect(records.filter((r) => r.kind === "user_prompt")).toHaveLength(1);
  });
});
