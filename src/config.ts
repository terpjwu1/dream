import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { defaultMemoryDir, dreamHome } from "./paths.js";

const RuntimeSchema = z.object({
  provider: z.string().default("claude-agent-sdk"),
  model: z.string().default("claude-fable-5"),
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
      sinceDays: z.number().positive().default(14),
      maxSessionsPerRun: z.number().int().positive().default(20),
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
      /** Profile-wide ambient dreaming (set via `dream init --global`): every
       *  project is dreamable without per-project init. Same consent bar —
       *  one explicit global opt-in instead of N project opt-ins. */
      global: z.boolean().default(false),
      /** Substring matches against project paths to exempt from global mode. */
      excludeProjects: z.array(z.string()).default([]),
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

/**
 * The one place `config.memory.dir ?? default` is resolved. Always absolute:
 * a relative memory.dir resolves against the PROJECT, never the process cwd
 * (Codex merge-gate finding — a cwd-relative git init is how you provision
 * the wrong directory).
 */
export function memoryDirFor(projectPath: string, config: Config): string {
  return config.memory.dir ? resolve(projectPath, config.memory.dir) : defaultMemoryDir(projectPath);
}

export interface Consent {
  /** May this project be dreamed at all? */
  dreamable: boolean;
  /** May dreaming start without an explicit user command? */
  ambient: boolean;
  source: "project" | "global" | "none";
}

/**
 * The single definition of consent, consumed by trigger AND status so they
 * can never disagree: a project is dreamable via its own init or the
 * profile-wide opt-in (`dream init --global`, minus exclusions); global
 * consent implies ambient consent — that is what --global grants.
 */
export function resolveConsent(projectPath: string, config: Config): Consent {
  if (existsSync(configPaths(projectPath).project)) {
    return { dreamable: true, ambient: config.trigger.enabled, source: "project" };
  }
  const global =
    config.trigger.global &&
    !config.trigger.excludeProjects.some((pattern) => projectPath.includes(pattern));
  return global
    ? { dreamable: true, ambient: true, source: "global" }
    : { dreamable: false, ambient: false, source: "none" };
}
