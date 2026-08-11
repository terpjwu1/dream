import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dreamHome } from "./paths.js";

const RuntimeSchema = z.object({
  provider: z.string().default("claude-agent-sdk"),
  model: z.string().default("claude-fable-5"),
  maxSteps: z.number().int().positive().optional(),
});

export const ConfigSchema = z.object({
  steering: z
    .string()
    .default(
      "What matters: repo conventions, recurring failures, tool misconfigurations, " +
        "corrections the user had to repeat. Ignore one-off typos and secrets.",
    ),
  reviewMode: z.enum(["branch", "auto"]).default("branch"),
  runtime: RuntimeSchema.prefault({}),
  analyzerRuntime: RuntimeSchema.prefault({}),
  prevalence: z
    .object({
      minSessions: z.number().int().min(1).default(2),
      minFraction: z.number().min(0).max(1).default(0),
    })
    .prefault({}),
  transcripts: z
    .object({
      source: z.string().default("claude-code"),
      sinceDays: z.number().positive().default(14),
      maxSessionsPerRun: z.number().int().positive().default(20),
      includeSubagents: z.boolean().default(false),
    })
    .prefault({}),
  budget: z
    .object({
      batchSizeSessions: z.number().int().positive().default(5),
      maxDigestTokensPerBatch: z.number().int().positive().default(40_000),
      maxConcurrentAnalyzers: z.number().int().positive().default(3),
      maxStepsPerAgent: z.number().int().positive().default(25),
      maxRunCostUsd: z.number().positive().default(5.0),
    })
    .prefault({}),
  memory: z.object({ dir: z.string().nullable().default(null) }).prefault({}),
  // enabled defaults FALSE: initializing a project for CLI use is not consent
  // for ambient background spend (Codex plan-review finding). /dream:setup or
  // the user flips it explicitly.
  trigger: z
    .object({
      enabled: z.boolean().default(false),
      minSessions: z.number().int().positive().default(3),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;

function readJsonIfExists(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Failed to parse config at ${path}: ${(err as Error).message}`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

export function configPaths(projectPath: string): { global: string; project: string } {
  return {
    global: join(dreamHome(), "config.json"),
    project: join(projectPath, ".dream", "config.json"),
  };
}

/** Project config overrides global config overrides schema defaults. */
export function loadConfig(projectPath: string): Config {
  const paths = configPaths(projectPath);
  const global = readJsonIfExists(paths.global) ?? {};
  const project = readJsonIfExists(paths.project) ?? {};
  return ConfigSchema.parse(deepMerge(global, project));
}
