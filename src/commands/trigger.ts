import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, memoryDirFor, resolveConsent, type Config } from "../config.js";
import { listDreamBranchesSafe } from "../git.js";
import { runsRoot } from "../paths.js";
import { projectFromPayload, readStdinCapped } from "../payload.js";
import { selectSessions } from "../pipeline/select.js";
import { loadState, runLockHeld } from "../state.js";

export type TriggerDecision =
  | { action: "none" }
  | { action: "info"; message: string } // explicit-mode outcomes that don't spawn
  | { action: "remind"; message: string }
  | { action: "run"; message: string };

/**
 * Pure decision logic for BOTH trigger paths, policy encoded once (Codex
 * review finding — no divergent orderings between ambient and explicit).
 *
 * Ambient (hook): opt-in by design — a project that never ran `dream init`
 * or never enabled ambient dreaming is silently skipped; background runs
 * cost real money.
 *
 * Explicit (`--now`, the /dream command): the invocation itself is consent,
 * so the enable gate and session threshold are waived — but init is still
 * required, pending reviews take precedence over everything (fresh proposals
 * are worth more than another run), and a held lock means a run is already
 * dreaming.
 */
export function decideTrigger(
  input: {
    initialized: boolean;
    enabled: boolean;
    minSessions: number;
    undreamed: number;
    pendingBranches: number;
    lockHeld: boolean;
  },
  opts: { now?: boolean } = {},
): TriggerDecision {
  const now = opts.now === true;
  if (!input.initialized) {
    return now
      ? { action: "info", message: "dream: project not set up — run /dream:setup (or `dream init`) first" }
      : { action: "none" };
  }
  if (!input.enabled && !now) return { action: "none" };
  if (input.pendingBranches > 0) {
    return {
      action: "remind",
      message: `🌙 dream: ${input.pendingBranches} proposal branch(es) awaiting review — /dream:review`,
    };
  }
  if (input.lockHeld) {
    return now
      ? { action: "info", message: "💤 dream: a dreaming run is already in progress" }
      : { action: "none" };
  }
  if (input.undreamed >= (now ? 1 : input.minSessions)) {
    return {
      action: "run",
      message: `💤 dream: dreaming over ${input.undreamed} session(s) in the background`,
    };
  }
  return now
    ? { action: "info", message: "dream: nothing to dream about — no un-dreamed sessions in the window" }
    : { action: "none" };
}

export async function gatherTriggerInput(
  projectPath: string,
  config: Config,
  opts: { full?: boolean } = {},
): Promise<Parameters<typeof decideTrigger>[0]> {
  const consent = resolveConsent(projectPath, config);
  // Ambient path short-circuits when not consented (hooks must be cheap);
  // --now needs the real counts even when ambient dreaming is off.
  if (!consent.dreamable || (!consent.ambient && !opts.full)) {
    return {
      initialized: consent.dreamable,
      enabled: consent.ambient,
      minSessions: 0,
      undreamed: 0,
      pendingBranches: 0,
      lockHeld: false,
    };
  }
  const [branches, { selected }] = await Promise.all([
    listDreamBranchesSafe(memoryDirFor(projectPath, config)),
    selectSessions(projectPath, config, loadState(projectPath)),
  ]);
  return {
    initialized: consent.dreamable,
    enabled: consent.ambient,
    minSessions: config.trigger.minSessions,
    undreamed: selected.length,
    pendingBranches: branches.length,
    lockHeld: runLockHeld(projectPath),
  };
}

/** Extract the project dir from a SessionStart hook payload. */
export const hookPayloadProject = projectFromPayload;

export async function readStdinProject(): Promise<string | undefined> {
  const raw = await readStdinCapped();
  return raw === undefined ? undefined : projectFromPayload(raw);
}

export async function triggerCommand(
  projectPath: string,
  opts: { now?: boolean } = {},
): Promise<void> {
  // Loop guard: never trigger from inside a dream-spawned process tree
  // (Codex plan-review finding — belt and suspenders; SDK sessions also run
  // with settingSources: [] so plugin hooks don't load there).
  if (process.env.DREAM_BACKGROUND === "1") return;
  const config = loadConfig(projectPath);
  const input = await gatherTriggerInput(projectPath, config, { full: opts.now });
  const decision = decideTrigger(input, { now: opts.now });

  if (decision.action === "none") return; // silent — hook adds nothing to context
  console.log(decision.message);
  if (decision.action !== "run") return;

  // Detached background run: survives the hook process, logs to a file.
  const logDir = runsRoot();
  mkdirSync(logDir, { recursive: true });
  const logFd = openSync(join(logDir, `trigger-${Date.now()}.log`), "a");
  // Double-spawn contract: if two session starts race past decideTrigger,
  // both spawn — but `dream run` acquires the O_EXCL run lock before any
  // pipeline work or badge writes, so the loser exits immediately (logged,
  // no badge written).
  try {
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
  } finally {
    closeSync(logFd); // child holds its own copy; don't leak ours until hook exit
  }
}
