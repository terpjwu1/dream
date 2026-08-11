#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";

const program = new Command();

program
  .name("dream")
  .description(
    "Background memory curation for coding agents — analyzes session transcripts " +
      "for cross-session patterns and proposes evidence-backed memory changes.",
  )
  .version("0.1.0");

const projectOption = ["--project <path>", "project directory (default: cwd)"] as const;

program
  .command("status")
  .description("Show watermark, un-dreamed sessions, pending review branches, last run")
  .option(...projectOption)
  .option("--json", "machine-readable output")
  .action(async (opts: { project?: string; json?: boolean }) => {
    const { statusCommand } = await import("./commands/status.js");
    await statusCommand(resolve(opts.project ?? process.cwd()), { json: opts.json });
  });

program
  .command("trigger")
  .description("SessionStart hook entrypoint: dream in the background when backlog warrants")
  .option(...projectOption)
  .option("--stdin", "read the hook JSON payload from stdin to locate the project")
  .action(async (opts: { project?: string; stdin?: boolean }) => {
    const { triggerCommand, readStdinProject } = await import("./commands/trigger.js");
    const fromStdin = opts.stdin ? await readStdinProject() : undefined;
    const project = opts.project ?? fromStdin;
    if (!project) return; // unparseable hook payload — stay silent
    await triggerCommand(resolve(project));
  });

program
  .command("statusline")
  .description("Status line renderer: reads Claude Code statusline JSON on stdin, prints the badge")
  .action(async () => {
    const { statuslineCommand } = await import("./commands/statusline.js");
    await statuslineCommand();
  });

program
  .command("run")
  .description("Run the dreaming pipeline: digest transcripts, analyze, propose memory changes")
  .option(...projectOption)
  .option("--since <dateOrDays>", "only sessions after this date, or e.g. 7d")
  .option("--dry-run", "full pipeline but write nothing and advance no watermark")
  .option("--max-sessions <n>", "cap sessions this run", (v: string) => parseInt(v, 10))
  .option("--mode <mode>", "review mode override: branch | auto")
  .option("--model <id>", "model override for all agents")
  .action(async (opts: Record<string, unknown>) => {
    const { runCommand } = await import("./commands/run.js");
    await runCommand(resolve((opts.project as string) ?? process.cwd()), opts);
  });

program
  .command("review")
  .description("Review pending proposals (branch mode: one dream/* branch at a time)")
  .option(...projectOption)
  .option("--accept", "accept the oldest pending dream branch (merge --no-ff)")
  .option("--reject", "reject the oldest pending dream branch (delete it)")
  .action(async (opts: { project?: string; accept?: boolean; reject?: boolean }) => {
    const { reviewCommand } = await import("./commands/review.js");
    await reviewCommand(resolve(opts.project ?? process.cwd()), opts);
  });

program
  .command("init")
  .description("Scaffold .dream/config.json and the memory store for this project")
  .option(...projectOption)
  .option("--mode <mode>", "review mode: branch | auto", "branch")
  .action(async (opts: { project?: string; mode?: string }) => {
    const { initCommand } = await import("./commands/init.js");
    await initCommand(resolve(opts.project ?? process.cwd()), opts);
  });

program
  .command("inspect", { hidden: true })
  .description("Debug: list sessions and digest stats for a project")
  .option(...projectOption)
  .option("--since <dateOrDays>", "window filter")
  .option("--session <id>", "print the full digest for one session")
  .action(async (opts: { project?: string; since?: string; session?: string }) => {
    const { inspectCommand } = await import("./commands/inspect.js");
    await inspectCommand(resolve(opts.project ?? process.cwd()), opts);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`dream: ${(err as Error).message}`);
  process.exitCode = 1;
});
