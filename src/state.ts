import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/** Atomic write (temp file + rename) so a crash can't corrupt the watermark. */
export function saveState(projectPath: string, state: State): void {
  const path = stateFile(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
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
