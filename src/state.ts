import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { stateFile } from "./paths.js";
import { deepRedact } from "./redact.js";
import type { LedgerDelta } from "./types.js";

const DreamedSessionSchema = z.object({
  at: z.string(),
  runId: z.string(),
  status: z.literal("analyzed"),
});

/** Categories that may be held as candidates: everything except stale_memory,
 *  which promotes at floor 1 and must never linger in (or promote out of)
 *  the ledger — enforced at parse time so legacy/malformed state can't
 *  reintroduce it (Codex review finding). */
export const CandidateCategorySchema = z.enum([
  "recurring_failure",
  "missing_knowledge",
  "tool_failure",
  "workflow_pattern",
  "style_pattern",
]);

/** A near-miss finding held across runs until proven (promoted) or expired. */
export const CandidateSchema = z.object({
  patternKey: z.string(), // FULL sha256 hex of normalized summary (record key)
  category: CandidateCategorySchema,
  summary: z.string(),
  detail: z.string(),
  validatedSessionIds: z.array(z.string()), // IMMUTABLE once written; append-only
  quotes: z.array(z.object({ sessionId: z.string(), excerpt: z.string() })),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  missedRuns: z.number().default(0),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const StateSchema = z.object({
  source: z.string().default("claude-code"),
  dreamedSessions: z.record(z.string(), DreamedSessionSchema).default({}),
  candidates: z.record(z.string(), CandidateSchema).default({}),
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

export function lockFile(projectPath: string): string {
  return `${stateFile(projectPath)}.lock`;
}

/** Read-only "is a run active" check, TTL-aware like acquireRunLock. */
export function runLockHeld(projectPath: string): boolean {
  try {
    return Date.now() - statSync(lockFile(projectPath)).mtimeMs < STALE_LOCK_MS;
  } catch {
    return false;
  }
}

/**
 * Per-project run lock (O_EXCL create). Prevents two concurrent `dream run`s
 * from selecting and analyzing the same sessions. Returns a release function.
 */
export function acquireRunLock(projectPath: string): () => void {
  const path = lockFile(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  // Owner token: takeover and release are guarded by content, not just
  // existence, so a stale-lock steal can't be double-won silently and
  // release can't delete a lock acquired by someone else.
  const token = `${process.pid}.${Math.random().toString(36).slice(2)}\n`;
  const tryAcquire = (): boolean => {
    try {
      writeFileSync(path, token, { flag: "wx" });
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    }
  };
  if (!tryAcquire()) {
    const age = Date.now() - statSync(path).mtimeMs;
    if (age < STALE_LOCK_MS) {
      throw new Error(
        `another dream run appears to be active for this project (lock: ${path}). ` +
          `If that's wrong, delete the lock file.`,
      );
    }
    try {
      rmSync(path); // stale — remove, then re-race for exclusive create
    } catch {
      // someone else removed it first; fall through to the re-race
    }
    if (!tryAcquire()) {
      throw new Error(`another dream run took over the stale lock (${path})`);
    }
  }
  return () => {
    try {
      if (readFileSync(path, "utf8") === token) rmSync(path);
    } catch {
      // already gone — fine
    }
  };
}

/** FULL sha256 of the normalized summary — the collision-safe record key.
 *  Normalization strips digits and path-like tokens so cosmetic variation
 *  ("failed 3 times in /a/b" vs "failed 5 times in /c/d") keys identically.
 *  A dedup/audit hint only — semantic matching stays with the agent. */
export function patternKey(summary: string): string {
  const normalized = summary
    .toLowerCase()
    .replace(/[/\\][^\s"']*/g, " ")
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export interface LedgerLimits {
  sinceDays: number;
  maxPerCategory: number;
  maxMissedRuns: number;
}

const MAX_QUOTES_PER_SESSION = 3;
const MAX_QUOTES_PER_CANDIDATE = 12;
const MAX_EXCERPT_CHARS = 240;

/**
 * Apply a run's LedgerDelta to (freshly loaded) state. Pure. Guardrails:
 * stored evidence is append-only (existing validatedSessionIds and quotes are
 * never edited), aging only happens on runs that actually analyzed sessions,
 * and everything persisted passes deepRedact.
 */
export function applyLedgerDelta(
  state: State,
  delta: LedgerDelta,
  limits: LedgerLimits,
  now = new Date(),
): State {
  const candidates: Record<string, Candidate> = { ...state.candidates };
  const touched = new Set([...delta.matchedKeys, ...delta.promotedKeys]);

  for (const key of delta.promotedKeys) delete candidates[key];

  for (const draft of delta.upserts) {
    touched.add(draft.patternKey);
    const existing = candidates[draft.patternKey];
    const newQuotes = capQuotes(
      draft.quotes.filter((q) => draft.sessionIds.includes(q.sessionId)),
      existing?.quotes ?? [],
    );
    candidates[draft.patternKey] = existing
      ? {
          ...existing, // summary/detail/firstSeenAt and prior evidence immutable
          validatedSessionIds: [
            ...existing.validatedSessionIds,
            ...draft.sessionIds.filter((id) => !existing.validatedSessionIds.includes(id)),
          ],
          quotes: newQuotes,
          lastSeenAt: now.toISOString(),
          missedRuns: 0,
        }
      : {
          patternKey: draft.patternKey,
          category: draft.category,
          summary: draft.summary,
          detail: draft.detail,
          validatedSessionIds: [...new Set(draft.sessionIds)],
          quotes: newQuotes,
          firstSeenAt: now.toISOString(),
          lastSeenAt: now.toISOString(),
          missedRuns: 0,
        };
  }

  if (delta.hadAnalyzedSessions) {
    for (const [key, candidate] of Object.entries(candidates)) {
      if (!touched.has(key)) candidates[key] = { ...candidate, missedRuns: candidate.missedRuns + 1 };
    }
  }

  return { ...state, candidates: deepRedact(pruneCandidates(candidates, limits, now)) };
}

function capQuotes(
  fresh: { sessionId: string; excerpt: string }[],
  existing: { sessionId: string; excerpt: string }[],
): { sessionId: string; excerpt: string }[] {
  const perSession = new Map<string, number>();
  for (const q of existing) perSession.set(q.sessionId, (perSession.get(q.sessionId) ?? 0) + 1);
  const out = [...existing]; // existing quotes are immutable — never dropped by an upsert
  for (const q of fresh) {
    if (out.length >= MAX_QUOTES_PER_CANDIDATE) break;
    const count = perSession.get(q.sessionId) ?? 0;
    if (count >= MAX_QUOTES_PER_SESSION) continue;
    perSession.set(q.sessionId, count + 1);
    out.push({ sessionId: q.sessionId, excerpt: q.excerpt.slice(0, MAX_EXCERPT_CHARS) });
  }
  return out;
}

export function pruneCandidates(
  candidates: Record<string, Candidate>,
  limits: LedgerLimits,
  now = new Date(),
): Record<string, Candidate> {
  const ttlMs = limits.sinceDays * 24 * 60 * 60 * 1000;
  const kept = Object.values(candidates).filter(
    (c) =>
      c.missedRuns <= limits.maxMissedRuns &&
      now.getTime() - new Date(c.lastSeenAt).getTime() <= ttlMs,
  );
  // Per-category cap: keep the most recently seen.
  const byCategory = new Map<string, Candidate[]>();
  for (const c of kept) {
    const bucket = byCategory.get(c.category) ?? [];
    bucket.push(c);
    byCategory.set(c.category, bucket);
  }
  const out: Record<string, Candidate> = {};
  for (const bucket of byCategory.values()) {
    bucket
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limits.maxPerCategory)
      .forEach((c) => (out[c.patternKey] = c));
  }
  return out;
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
