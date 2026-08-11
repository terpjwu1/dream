import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Thin git wrapper — args arrays only, never shell interpolation. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trimEnd();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`git ${args[0]} failed: ${(e.stderr ?? e.message).trim()}`);
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, "rev-parse", "--git-dir");
    return true;
  } catch {
    return false;
  }
}

export async function isClean(cwd: string): Promise<boolean> {
  return (await git(cwd, "status", "--porcelain")) === "";
}

/** Current branch name; throws a descriptive error on detached HEAD. */
export async function currentBranch(cwd: string): Promise<string> {
  try {
    return await git(cwd, "symbolic-ref", "--short", "HEAD");
  } catch {
    throw new Error(
      "memory repo is on a detached HEAD — check out a named branch before running dream",
    );
  }
}

/** listDreamBranches for possibly-nonexistent repos: [] instead of throwing. */
export async function listDreamBranchesSafe(cwd: string): Promise<string[]> {
  return (await isGitRepo(cwd)) ? listDreamBranches(cwd) : [];
}

/** git init -b main + baseline commit — shared by `dream init` and branch-mode auto-provisioning. */
export async function initRepoWithBaseline(cwd: string, message: string): Promise<void> {
  await git(cwd, "init", "-b", "main");
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-m", message);
}

export async function listDreamBranches(cwd: string): Promise<string[]> {
  const out = await git(
    cwd,
    "for-each-ref",
    "--sort=committerdate",
    "--format=%(refname:short)",
    "refs/heads/dream/",
  );
  return out ? out.split("\n") : [];
}
