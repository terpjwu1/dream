import type { Config } from "../config.js";
import type { State } from "../state.js";
import type { SessionRef } from "../types.js";
import { ClaudeCodeSource } from "../sources/claudeCode.js";

const LIVE_SESSION_THRESHOLD_MS = 10 * 60 * 1000;

export interface Selection {
  selected: SessionRef[];
  skippedLive: number;
  skippedDreamed: number;
}

/**
 * Pick the sessions this run should dream about: inside the window, not
 * already analyzed, not currently live. Known v1 limitation: an open session
 * idle for >10 minutes passes the mtime guard.
 */
export async function selectSessions(
  projectPath: string,
  config: Config,
  state: State,
  opts: { since?: Date; maxSessions?: number; now?: Date } = {},
): Promise<Selection> {
  const source = new ClaudeCodeSource();
  const now = opts.now ?? new Date();
  const since =
    opts.since ?? new Date(now.getTime() - config.transcripts.sinceDays * 24 * 60 * 60 * 1000);

  const all = await source.listSessions(projectPath, { since });
  let skippedLive = 0;
  let skippedDreamed = 0;
  const currentSession = process.env.CLAUDE_SESSION_ID; // present when run from inside Claude Code

  const eligible = all.filter((ref) => {
    if (state.dreamedSessions[ref.sessionId]) {
      skippedDreamed++;
      return false;
    }
    if (
      now.getTime() - ref.endedAt.getTime() < LIVE_SESSION_THRESHOLD_MS ||
      ref.sessionId === currentSession
    ) {
      skippedLive++;
      return false;
    }
    return true;
  });

  const max = opts.maxSessions ?? config.transcripts.maxSessionsPerRun;
  // Prefer the most recent sessions when over the cap.
  const selected = eligible.slice(-max);
  return { selected, skippedLive, skippedDreamed };
}
