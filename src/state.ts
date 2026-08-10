import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { stateFile } from "./paths.js";

const DreamedSessionSchema = z.object({
  at: z.string(),
  runId: z.string(),
  status: z.literal("analyzed"),
});

export const StateSchema = z.object({
  source: z.string().default("claude-code"),
  dreamedSessions: z.record(z.string(), DreamedSessionSchema).default({}),
  lastRun: z
    .object({
      runId: z.string(),
      at: z.string(),
      proposals: z.number(),
      costUsd: z.number().optional(),
      partial: z.boolean().default(false),
    })
    .optional(),
});

export type State = z.infer<typeof StateSchema>;

export function loadState(projectPath: string): State {
  try {
    const raw = JSON.parse(readFileSync(stateFile(projectPath), "utf8"));
    return StateSchema.parse(raw);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return StateSchema.parse({});
    throw new Error(
      `Corrupt state file ${stateFile(projectPath)}: ${(err as Error).message}. ` +
        `Fix or delete it to reset the watermark.`,
    );
  }
}

/** Atomic write (unique temp file + rename) so a crash can't corrupt the watermark. */
export function saveState(projectPath: string, state: State): void {
  const path = stateFile(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

const STALE_LOCK_MS = 60 * 60 * 1000;

/**
 * Per-project run lock (O_EXCL create). Prevents two concurrent `dream run`s
 * from selecting and analyzing the same sessions. Returns a release function.
 */
export function acquireRunLock(projectPath: string): () => void {
  const path = `${stateFile(projectPath)}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < STALE_LOCK_MS) {
      throw new Error(
        `another dream run appears to be active for this project (lock: ${path}). ` +
          `If that's wrong, delete the lock file.`,
      );
    }
    writeFileSync(path, `${process.pid} ${new Date().toISOString()}\n`); // steal stale lock
  }
  return () => {
    try {
      rmSync(path);
    } catch {
      // already gone — fine
    }
  };
}

/** Mark sessions analyzed after a successful (non-dry) run. */
export function markDreamed(state: State, sessionIds: string[], runId: string): State {
  const at = new Date().toISOString();
  const dreamedSessions = { ...state.dreamedSessions };
  for (const id of sessionIds) {
    dreamedSessions[id] = { at, runId, status: "analyzed" };
  }
  return { ...state, dreamedSessions };
}
