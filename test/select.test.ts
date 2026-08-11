import { describe, expect, it, vi } from "vitest";
import { selectSessions } from "../src/pipeline/select.js";
import { ConfigSchema } from "../src/config.js";
import { StateSchema } from "../src/state.js";
import type { SessionRef } from "../src/types.js";
import { ClaudeCodeSource } from "../src/sources/claudeCode.js";

const NOW = new Date("2026-08-09T12:00:00Z");

function ref(id: string, endedMinutesAgo: number): SessionRef {
  return {
    sessionId: id,
    filePath: `/fake/${id}.jsonl`,
    startedAt: new Date(NOW.getTime() - (endedMinutesAgo + 30) * 60_000),
    endedAt: new Date(NOW.getTime() - endedMinutesAgo * 60_000),
    sizeBytes: 1000,
    projectPath: "/p",
  };
}

describe("selectSessions", () => {
  it("skips dreamed, live, and over-cap sessions", async () => {
    const refs = [ref("old", 600), ref("dreamed", 500), ref("fresh", 60), ref("live", 2)];
    vi.spyOn(ClaudeCodeSource.prototype, "listSessions").mockResolvedValue(refs);

    const config = ConfigSchema.parse({ transcripts: { maxSessionsPerRun: 2 } });
    const state = StateSchema.parse({
      dreamedSessions: { dreamed: { at: "x", runId: "r", status: "analyzed" } },
    });

    const { selected, skippedLive, skippedDreamed } = await selectSessions(
      "/p",
      config,
      state,
      { now: NOW },
    );

    expect(selected.map((r) => r.sessionId)).toEqual(["old", "fresh"]);
    expect(skippedLive).toBe(1);
    expect(skippedDreamed).toBe(1);
  });
});
