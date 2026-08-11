import type { SessionRecord, SessionRef } from "../types.js";

/**
 * Adapter contract for coding-agent transcript formats. v1 ships claude-code;
 * future adapters (codex, gemini, copilot) map their session logs into the
 * same normalized SessionRecord stream and the rest of the pipeline is
 * source-agnostic.
 */
export interface TranscriptSource {
  readonly id: string;
  listSessions(projectPath: string, opts?: { since?: Date }): Promise<SessionRef[]>;
  readSession(ref: SessionRef): AsyncIterable<SessionRecord>;
}
