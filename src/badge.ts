import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { badgeFile } from "./paths.js";

/**
 * The badge is a single preformatted line shown verbatim in the Claude Code
 * status line. Writing it as ready-to-display text means the statusline
 * command does zero parsing at render time.
 */
export function writeBadge(projectPath: string, text: string): void {
  const path = badgeFile(projectPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.trim() + "\n", "utf8");
}

export function clearBadge(projectPath: string): void {
  try {
    rmSync(badgeFile(projectPath));
  } catch {
    // no badge — fine
  }
}

export function readBadge(projectPath: string): string | undefined {
  try {
    return readFileSync(badgeFile(projectPath), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

const ACTIVE_BADGE_TTL_MS = 30 * 60 * 1000;

/**
 * Badge for display. A 💤 "dreaming" badge only means something while a run
 * is alive — a hard crash (SIGKILL, sleep, power loss) can strand one, so
 * active badges expire after 30 minutes of no updates. Terminal badges
 * (🌙 review reminders, ⚠ failures) point at durable state and persist.
 */
export function displayBadge(projectPath: string, now = Date.now()): string | undefined {
  const text = readBadge(projectPath);
  if (!text) return undefined;
  if (text.startsWith("💤")) {
    try {
      if (now - statSync(badgeFile(projectPath)).mtimeMs > ACTIVE_BADGE_TTL_MS) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return text;
}
