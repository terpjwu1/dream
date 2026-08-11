import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { configPaths, loadConfig, type Config } from "../config.js";
import { listDreamBranches, isGitRepo } from "../git.js";
import { defaultMemoryDir, dreamHome, stateFile } from "../paths.js";
import { selectSessions } from "../pipeline/select.js";
import { loadState } from "../state.js";

export type TriggerDecision =
  | { action: "none" }
  | { action: "remind"; message: string }
  | { action: "run"; message: string };

/**
 * Pure decision logic for the SessionStart hook. Opt-in by design: a project
 * that never ran `dream init` (no project config) is never dreamed —
 * background runs cost real money.
 */
export function decideTrigger(input: {
  initialized: boolean;
  enabled: boolean;
  minSessions: number;
  undreamed: number;
  pendingBranches: number;
  lockHeld: boolean;
}): TriggerDecision {
  if (!input.initialized || !input.enabled) return { action: "none" };
  if (input.pendingBranches > 0) {
    return {
      action: "remind",
      message: `🌙 dream: ${input.pendingBranches} proposal branch(es) awaiting review — /dream:review`,
    };
  }
  if (input.lockHeld) return { action: "none" };
  if (input.undreamed >= input.minSessions) {
    return {
      action: "run",
      message: `💤 dream: dreaming over ${input.undreamed} session(s) in the background`,
    };
  }
  return { action: "none" };
}

export async function gatherTriggerInput(
  projectPath: string,
  config: Config,
): Promise<Parameters<typeof decideTrigger>[0]> {
  const initialized = existsSync(configPaths(projectPath).project);
  if (!initialized || !config.trigger.enabled) {
    return { initialized, enabled: config.trigger.enabled, minSessions: 0, undreamed: 0, pendingBranches: 0, lockHeld: false };
  }
  const memoryDir = config.memory.dir ?? defaultMemoryDir(projectPath);
  const pendingBranches = (await isGitRepo(memoryDir))
    ? (await listDreamBranches(memoryDir)).length
    : 0;
  const { selected } = await selectSessions(projectPath, config, loadState(projectPath));
  return {
    initialized,
    enabled: config.trigger.enabled,
    minSessions: config.trigger.minSessions,
    undreamed: selected.length,
    pendingBranches,
    lockHeld: existsSync(`${stateFile(projectPath)}.lock`),
  };
}

/** Extract the project dir from a SessionStart hook payload. */
export function hookPayloadProject(payloadJson: string): string | undefined {
  try {
    const payload = JSON.parse(payloadJson);
    return payload?.cwd ?? payload?.workspace?.current_dir ?? undefined;
  } catch {
    return undefined;
  }
}

export async function readStdinProject(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return hookPayloadProject(Buffer.concat(chunks).toString("utf8"));
}

export async function triggerCommand(projectPath: string): Promise<void> {
  // Loop guard: never trigger from inside a dream-spawned process tree
  // (Codex plan-review finding — belt and suspenders; SDK sessions also run
  // with settingSources: [] so plugin hooks don't load there).
  if (process.env.DREAM_BACKGROUND === "1") return;
  const config = loadConfig(projectPath);
  const decision = decideTrigger(await gatherTriggerInput(projectPath, config));

  if (decision.action === "none") return; // silent — hook adds nothing to context
  console.log(decision.message);
  if (decision.action === "remind") return;

  // Detached background run: survives the hook process, logs to a file.
  const logDir = join(dreamHome(), "runs");
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(join(logDir, `trigger-${Date.now()}.log`), "a");
  // Double-spawn contract: if two session starts race past decideTrigger,
  // both spawn — but `dream run` acquires the O_EXCL run lock as its FIRST
  // operation, so the loser exits immediately (logged, no badge written).
  const child = spawn(
    process.execPath,
    [process.argv[1]!, "run", "--project", projectPath],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, DREAM_BACKGROUND: "1" },
    },
  );
  child.unref();
}
