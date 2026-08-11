import { describe, expect, it } from "vitest";
import { digestSession, estimateTokens, summarizeToolInput } from "../src/digest/digester.js";
import { mapRecord } from "../src/sources/claudeCode.js";
import type { SessionRecord, SessionRef } from "../src/types.js";
import { FIXTURE_LINES, FIXTURE_SESSION_ID } from "./fixtures/session-fixture.js";

const ref: SessionRef = {
  sessionId: FIXTURE_SESSION_ID,
  filePath: "/tmp/fixture.jsonl",
  startedAt: new Date("2026-08-01T10:00:00Z"),
  endedAt: new Date("2026-08-01T10:01:05Z"),
  sizeBytes: 1000,
  projectPath: "/Users/test/proj",
};

function fixtureRecords(): SessionRecord[] {
  return FIXTURE_LINES.flatMap((l) => [...mapRecord(l)]);
}

describe("digestSession", () => {
  it("computes stats and keeps error/interruption signal", async () => {
    const digest = await digestSession(ref, fixtureRecords());
    expect(digest.stats).toEqual({ userTurns: 1, toolCalls: 2, toolErrors: 1, interrupted: 1 });
    expect(digest.gitBranch).toBe("feat/demo");
    expect(digest.models).toEqual(["claude-fable-5"]);
    expect(digest.markdown).toContain("MISSING_ENV_VAR");
    expect(digest.markdown).toContain("INTERRUPTED-BY-USER");
    expect(digest.markdown).toContain("./deploy.sh --prod");
    expect(digest.markdown).not.toContain("SHOULD BE DROPPED");
  });

  it("tightens caps to fit a token budget", async () => {
    const noisy: SessionRecord[] = [
      ...fixtureRecords(),
      ...Array.from({ length: 50 }, (_, i): SessionRecord => ({
        kind: "assistant_text",
        text: `verbose explanation ${"x".repeat(2000)}`,
        model: "claude-fable-5",
        ts: `2026-08-01T10:0${i % 10}:00.000Z`,
        uuid: `noise-${i}`,
      })),
    ];
    const digest = await digestSession(ref, noisy, { maxTokens: 4000 });
    expect(digest.approxTokens).toBeLessThanOrEqual(4500); // budget + floor slack
    expect(digest.markdown).toContain("MISSING_ENV_VAR"); // signal survives squeeze
  });
});

describe("summarizeToolInput", () => {
  it("keeps Bash commands verbatim", () => {
    expect(summarizeToolInput("Bash", { command: "npm test", description: "Run tests" })).toBe(
      "npm test  # Run tests",
    );
  });
  it("JSON-stringifies other tools", () => {
    expect(summarizeToolInput("Read", { file_path: "/a.ts" })).toBe('{"file_path":"/a.ts"}');
  });
});

describe("estimateTokens", () => {
  it("uses chars/4", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });
});
