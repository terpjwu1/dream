import { memoryDirFor, type Config } from "../config.js";
import { currentBranch, git, initRepoWithBaseline, isClean, isGitRepo } from "../git.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { redactSecrets } from "../redact.js";
import { formatEvidenceLines, formatPrevalence } from "./evidence.js";
import type { Proposal, RunReport } from "../types.js";

/**
 * Branch-mode output: one commit per proposal on a dream/* branch, evidence
 * in the commit body, MEMORY.md regenerated in a final commit. The user
 * reviews with normal git tooling (or `dream review`).
 */
export async function applyBranchMode(
  projectPath: string,
  config: Config,
  report: RunReport,
): Promise<void> {
  const memoryDir = memoryDirFor(projectPath, config); // always absolute
  const store = new FileMemoryStore(memoryDir);

  // Preflight — fail closed before touching anything. A missing repo is
  // auto-provisioned (globally-dreamed projects never ran `dream init`);
  // this only ever touches dream's own store dir, never user code.
  if (!(await isGitRepo(memoryDir))) {
    await store.regenerateIndex(); // creates the dir + MEMORY.md if absent
    await initRepoWithBaseline(memoryDir, "dream: memory store baseline (auto-provisioned)");
  }
  if (!(await isClean(memoryDir))) {
    throw new Error(`memory repo has uncommitted changes — commit or stash them first`);
  }
  const original = await currentBranch(memoryDir);
  const branch = `dream/${report.runId}`;

  await git(memoryDir, "checkout", "-b", branch);
  try {
    for (const proposal of report.proposals) {
      await store.apply(proposal);
      await git(memoryDir, "add", "-A");
      await git(memoryDir, "commit", "-m", commitSubject(proposal), "-m", commitBody(proposal, report));
    }
    await store.regenerateIndex();
    await git(memoryDir, "add", "-A");
    if (!(await isClean(memoryDir))) {
      await git(memoryDir, "commit", "-m", "dream: regenerate MEMORY.md index");
    }
  } finally {
    try {
      // Drop any half-applied, uncommitted proposal before leaving the dream
      // branch, so a mid-commit failure can't carry staged changes back.
      await git(memoryDir, "reset", "--hard", "HEAD");
      await git(memoryDir, "checkout", original);
    } catch {
      console.error(
        `\n⚠ could not return to branch "${original}" — the memory repo at\n` +
          `  ${memoryDir}\n  is still on ${branch}. Recover with:\n` +
          `  git -C "${memoryDir}" checkout ${original}`,
      );
    }
  }

  console.log(
    `\n${report.proposals.length} proposal(s) committed to branch ${branch} in ${memoryDir}\n` +
      `review:  dream review --project ${projectPath}\n` +
      `  or:    git -C "${memoryDir}" log ${original}..${branch} --stat`,
  );
}

function commitSubject(p: Proposal): string {
  const name = p.path.replace(/\.md$/, "");
  return `dream(${p.op}): ${name}`;
}

function commitBody(p: Proposal, report: RunReport): string {
  const lines = [
    p.rationale,
    "",
    formatPrevalence(p.finding),
    "",
    ...formatEvidenceLines(p.finding),
    "",
    `Run: ${report.runId}`,
    `Finding: ${p.finding.id} [${p.finding.category}]`,
  ];
  return redactSecrets(lines.join("\n"));
}
