import { existsSync } from "node:fs";
import { loadConfig, configPaths, memoryDirFor, resolveConsent } from "../config.js";
import { listDreamBranchesSafe } from "../git.js";
import { loadState } from "../state.js";
import { claudeProjectDir, stateFile } from "../paths.js";
import { selectSessions } from "../pipeline/select.js";

export async function statusCommand(
  projectPath: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const config = loadConfig(projectPath);
  const state = loadState(projectPath);
  const paths = configPaths(projectPath);
  const memoryDir = memoryDirFor(projectPath, config);
  // Same consent definition the trigger uses — status can never disagree.
  const consent = resolveConsent(projectPath, config);
  const [pendingBranches, { selected, skippedLive }] = await Promise.all([
    listDreamBranchesSafe(memoryDir),
    selectSessions(projectPath, config, state),
  ]);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          project: projectPath,
          initialized: consent.dreamable,
          consentSource: consent.source,
          ambient: consent.ambient,
          reviewMode: config.reviewMode,
          memoryDir,
          undreamed: selected.length,
          skippedLive,
          dreamedCount: Object.keys(state.dreamedSessions).length,
          pendingBranches,
          candidates: Object.values(state.candidates).map((c) => ({
            patternKey: c.patternKey.slice(0, 12),
            category: c.category,
            summary: c.summary,
            sessions: c.validatedSessionIds.length,
            lastSeenAt: c.lastSeenAt,
          })),
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
  console.log(`memory dir:  ${memoryDir}`);
  console.log(
    `config:      ${existsSync(paths.project) ? paths.project : existsSync(paths.global) ? paths.global : "(defaults — run `dream init`)"}`,
  );
  console.log(
    `consent:     ${consent.source}${consent.ambient ? " (ambient)" : consent.dreamable ? " (manual only)" : ""}`,
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
  if (pendingBranches.length > 0) {
    console.log(`pending:     ${pendingBranches.length} dream branch(es) — run \`dream review\``);
  }
  const candidateCount = Object.keys(state.candidates).length;
  if (candidateCount > 0) {
    console.log(`suspicions:  ${candidateCount} pattern(s) accumulating evidence across runs`);
    for (const c of Object.values(state.candidates).slice(0, 5)) {
      console.log(
        `  ~ [${c.category}] ${c.summary.slice(0, 80)} (${c.validatedSessionIds.length} session(s))`,
      );
    }
  }
}
