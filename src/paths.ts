import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Claude Code stores per-project data under a directory whose name is the
 * project's absolute path with every non-alphanumeric character replaced by
 * "-" (e.g. /Users/jwu/Documents/dream -> -Users-jwu-Documents-dream).
 */
export function mungeProjectPath(projectPath: string): string {
  return resolve(projectPath).replace(/[^a-zA-Z0-9]/g, "-");
}

export function claudeProjectDir(projectPath: string): string {
  return join(homedir(), ".claude", "projects", mungeProjectPath(projectPath));
}

export function defaultMemoryDir(projectPath: string): string {
  return join(claudeProjectDir(projectPath), "memory");
}

/** DREAM_HOME overrides the state/config root (tests, or relocated homes).
 *  The plugin hook honors the same variable — keep them consistent. */
export function dreamHome(): string {
  return process.env.DREAM_HOME ?? join(homedir(), ".dream");
}

export function stateFile(projectPath: string): string {
  return join(dreamHome(), "state", `${mungeProjectPath(projectPath)}.json`);
}

export function runsRoot(): string {
  return join(dreamHome(), "runs");
}

export function runsDir(runId: string): string {
  return join(runsRoot(), runId);
}

export function badgeFile(projectPath: string): string {
  return join(dreamHome(), "state", `${mungeProjectPath(projectPath)}.statusline`);
}
