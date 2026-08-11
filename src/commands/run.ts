import { clearBadge, writeBadge } from "../badge.js";
import { ClaudeAgentRunner } from "../agents/claudeRunner.js";
import { loadConfig } from "../config.js";
import { runsDir, runsRoot } from "../paths.js";
import { commitWatermark, runPipeline } from "../pipeline/run.js";
import { printReport } from "../output/report.js";
import { parseSince } from "../since.js";
import { acquireRunLock } from "../state.js";

export interface RunCommandOptions {
  since?: string;
  dryRun?: boolean;
  maxSessions?: number;
  mode?: string;
  model?: string;
}

export async function runCommand(
  projectPath: string,
  opts: RunCommandOptions,
): Promise<void> {
  const config = loadConfig(projectPath);
  if (opts.mode !== undefined) {
    // Validate strictly: an unrecognized --mode must never fall through to
    // auto and bypass the review gate (Codex merge-gate finding).
    if (opts.mode !== "branch" && opts.mode !== "auto") {
      throw new Error(`invalid --mode "${opts.mode}" (expected: branch | auto)`);
    }
    config.reviewMode = opts.mode;
  }
  if (opts.model) {
    config.runtime.model = opts.model;
    config.analyzerRuntime.model = opts.model;
  }

  const dryRun = opts.dryRun === true;
  // Parse CLI options BEFORE the failure-badge try: a typo'd --since is a
  // usage error, not a run failure, and must not persist a ⚠ badge.
  const since = opts.since ? parseSince(opts.since) : undefined;
  const releaseLock = acquireRunLock(projectPath);
  try {
    const runner = new ClaudeAgentRunner({ debugDir: runsDir("debug") });
    const report = await runPipeline(projectPath, config, runner, {
      since,
      maxSessions: opts.maxSessions,
      dryRun,
    });
    printReport(report);

    if (dryRun) {
      console.log(
        `dry run — proposals saved to ${runsDir(report.runId)}/report.json, nothing applied`,
      );
      return;
    }

    // Output first, watermark second: if branch/auto output throws, the
    // sessions stay un-dreamed and the next run retries them.
    if (report.proposals.length > 0) {
      if (config.reviewMode === "branch") {
        const { applyBranchMode } = await import("../output/branchMode.js");
        await applyBranchMode(projectPath, config, report);
        writeBadge(projectPath, `🌙 ${report.proposals.length} proposal(s) · /dream:review`);
      } else {
        const { applyAutoMode } = await import("../output/autoMode.js");
        await applyAutoMode(projectPath, config, report);
        writeBadge(projectPath, `🌙 ${report.proposals.length} memory update(s) auto-applied`);
      }
    } else {
      clearBadge(projectPath);
    }
    commitWatermark(projectPath, report, config);
  } catch (err) {
    if (!dryRun) writeBadge(projectPath, `⚠ dream run failed · see ${runsRoot()}/`);
    throw err;
  } finally {
    releaseLock();
  }
}
