import { existsSync } from "node:fs";
import { loadConfig, configPaths } from "../config.js";
import { loadState } from "../state.js";
import { claudeProjectDir, defaultMemoryDir, stateFile } from "../paths.js";

export async function statusCommand(projectPath: string): Promise<void> {
  const config = loadConfig(projectPath);
  const state = loadState(projectPath);
  const paths = configPaths(projectPath);

  console.log(`project:     ${projectPath}`);
  console.log(`transcripts: ${claudeProjectDir(projectPath)}`);
  console.log(`memory dir:  ${config.memory.dir ?? defaultMemoryDir(projectPath)}`);
  console.log(
    `config:      ${existsSync(paths.project) ? paths.project : existsSync(paths.global) ? paths.global : "(defaults — run `dream init`)"}`,
  );
  console.log(`review mode: ${config.reviewMode}`);
  console.log(`state file:  ${stateFile(projectPath)}`);
  console.log(`dreamed sessions: ${Object.keys(state.dreamedSessions).length}`);

  if (state.lastRun) {
    const { runId, at, proposals, costUsd, partial } = state.lastRun;
    console.log(
      `last run:    ${runId} at ${at} — ${proposals} proposal(s)` +
        (costUsd !== undefined ? `, $${costUsd.toFixed(2)}` : "") +
        (partial ? " [PARTIAL RUN]" : ""),
    );
  } else {
    console.log("last run:    never");
  }

}
