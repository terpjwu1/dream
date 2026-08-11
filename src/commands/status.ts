import { existsSync } from "node:fs";
import { loadConfig, configPaths } from "../config.js";
import { loadState } from "../state.js";
import { claudeProjectDir, defaultMemoryDir, stateFile } from "../paths.js";

export async function statusCommand(
  projectPath: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const config = loadConfig(projectPath);
  const state = loadState(projectPath);
  const paths = configPaths(projectPath);

  if (opts.json) {
    const { selectSessions } = await import("../pipeline/select.js");
    const { isGitRepo, listDreamBranches } = await import("../git.js");
    const { selected, skippedLive } = await selectSessions(projectPath, config, state);
    const memoryDir = config.memory.dir ?? defaultMemoryDir(projectPath);
    const pendingBranches = (await isGitRepo(memoryDir))
      ? await listDreamBranches(memoryDir)
      : [];
    console.log(
      JSON.stringify(
        {
          project: projectPath,
          initialized: existsSync(paths.project),
          reviewMode: config.reviewMode,
          memoryDir,
          undreamed: selected.length,
          skippedLive,
          dreamedCount: Object.keys(state.dreamedSessions).length,
          pendingBranches,
          lastRun: state.lastRun ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

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

  const { selectSessions } = await import("../pipeline/select.js");
  const { selected, skippedLive } = await selectSessions(projectPath, config, state);
  const totalKb = selected.reduce((sum, r) => sum + r.sizeBytes, 0) / 1024;
  console.log(
    `un-dreamed:  ${selected.length} session(s) in window (${totalKb.toFixed(0)}KB)` +
      (skippedLive > 0 ? `, ${skippedLive} skipped as live` : ""),
  );
  for (const ref of selected.slice(0, 10)) {
    console.log(
      `  - ${ref.sessionId.slice(0, 8)}  ${ref.endedAt.toISOString().slice(0, 16)}  ${(ref.sizeBytes / 1024).toFixed(0)}KB`,
    );
  }
  if (selected.length > 10) console.log(`  … and ${selected.length - 10} more`);
}
