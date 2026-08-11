import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clearBadge, writeBadge } from "../badge.js";
import { loadConfig, memoryDirFor } from "../config.js";
import { currentBranch, git, isGitRepo, listDreamBranches } from "../git.js";
import { runLockHeld } from "../state.js";

/** Branch mode: handle ONE dream/* branch at a time, oldest first. */
export async function reviewCommand(
  projectPath: string,
  opts: { accept?: boolean; reject?: boolean },
): Promise<void> {
  const config = loadConfig(projectPath);
  const memoryDir = memoryDirFor(projectPath, config);

  if (config.reviewMode === "auto") {
    const changelog = join(memoryDir, "CHANGELOG.md");
    if (!existsSync(changelog)) {
      console.log("auto mode — no CHANGELOG.md yet (no runs have applied changes)");
      return;
    }
    const entries = readFileSync(changelog, "utf8").split(/^## /m).filter(Boolean);
    console.log(`auto mode — latest changelog entry:\n\n## ${entries[entries.length - 1]}`);
    return;
  }

  if (!(await isGitRepo(memoryDir))) {
    throw new Error(`memory dir ${memoryDir} is not a git repo — nothing to review`);
  }
  const branches = await listDreamBranches(memoryDir);
  if (branches.length === 0) {
    console.log("no pending dream/* branches");
    return;
  }

  const target = branches[0]!; // oldest first
  // Everything above this guard is read-only (for-each-ref, symbolic-ref);
  // every mutating git op (merge, branch -D) happens after it.
  const base = await currentBranch(memoryDir);
  if (base.startsWith("dream/")) {
    throw new Error(
      `memory repo is checked out on ${base} — switch to your base branch first ` +
        `(git -C "${memoryDir}" checkout main), then run dream review`,
    );
  }

  if (opts.accept && opts.reject) throw new Error("pass --accept or --reject, not both");

  if (opts.accept) {
    try {
      await git(memoryDir, "merge", "--no-ff", target, "-m", `dream: accept ${target}`);
      await git(memoryDir, "branch", "-D", target);
      console.log(`accepted ${target} into ${base}`);
    } catch (err: unknown) {
      throw new Error(
        `${(err as Error).message}\n` +
          `Merge conflict? Resolve and commit in ${memoryDir}, then delete the branch —\n` +
          `or run: git -C "${memoryDir}" merge --abort`,
      );
    }
  } else if (opts.reject) {
    await git(memoryDir, "branch", "-D", target);
    console.log(`rejected and deleted ${target}`);
  } else {
    console.log(`pending dream branches (oldest first, review one at a time):`);
    for (const b of branches) console.log(`  - ${b}${b === target ? "  ← current" : ""}`);
    console.log(`\nproposals in ${target}:`);
    console.log(await git(memoryDir, "log", `${base}..${target}`, "--stat", "--format=%h %s%n%b"));
    console.log(
      `accept: dream review --project ${projectPath} --accept\n` +
        `reject: dream review --project ${projectPath} --reject`,
    );
  }

  if (opts.accept || opts.reject) {
    // A background run may own this badge. Order matters: recount branches
    // FIRST, then revalidate the lock IMMEDIATELY before touching the badge
    // (Codex verification finding). Residual races are microsecond-wide and
    // self-healing: an active run rewrites the badge at every stage and at
    // completion, so any stale touch here is overwritten by the run's truth.
    const remaining = (await listDreamBranches(memoryDir)).length;
    const runActive = runLockHeld(projectPath);
    if (remaining > 0) {
      // Branch count, not proposal count — proposals-per-branch varies.
      if (!runActive) {
        writeBadge(projectPath, `🌙 ${remaining} proposal branch(es) · /dream:review`);
      }
      console.log(`${remaining} more pending branch(es) — run dream review again`);
    } else if (!runActive) {
      clearBadge(projectPath);
    }
  }
}
