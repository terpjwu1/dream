import { ClaudeAgentRunner } from "../agents/claudeRunner.js";
import { loadConfig } from "../config.js";
import { runsDir } from "../paths.js";
import { runPipeline } from "../pipeline/run.js";
import { printReport } from "../output/report.js";
import { parseSince } from "../since.js";

export async function runCommand(
  projectPath: string,
  opts: Record<string, unknown>,
): Promise<void> {
  const config = loadConfig(projectPath);
  if (opts.mode) config.reviewMode = opts.mode as "branch" | "auto";
  if (opts.model) {
    config.runtime.model = opts.model as string;
    config.analyzerRuntime.model = opts.model as string;
  }

  const dryRun = opts.dryRun === true;
  const runner = new ClaudeAgentRunner({ debugDir: runsDir("debug") });
  const report = await runPipeline(
    projectPath,
    config,
    runner,
    {
      since: opts.since ? parseSince(opts.since as string) : undefined,
      maxSessions: opts.maxSessions as number | undefined,
      dryRun,
    },
  );
  printReport(report);

  if (dryRun) {
    console.log(`dry run — proposals saved to ${runsDir(report.runId)}/report.json, nothing applied`);
    return;
  }
  if (report.proposals.length === 0) return;

  if (config.reviewMode === "branch") {
    const { applyBranchMode } = await import("../output/branchMode.js");
    await applyBranchMode(projectPath, config, report);
  } else {
    const { applyAutoMode } = await import("../output/autoMode.js");
    await applyAutoMode(projectPath, config, report);
  }
}
