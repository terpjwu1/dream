#!/usr/bin/env node
// dream SessionStart hook: forward the payload to `dream trigger`, which
// decides whether to start a background dreaming run (opt-in per project).
// Cross-platform (node, not bash) and silent when the dream CLI is missing —
// a hook must never break a session, and must barely delay one: the actual
// dreaming always runs in a detached child, never on the session path.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.env.DREAM_BACKGROUND === "1") process.exit(0);

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const input = Buffer.concat(chunks);

  // Fast path: dreaming is opt-in per project (.dream/config.json). For the
  // overwhelmingly common case — a project that never opted in — exit after
  // one existsSync instead of paying a second node startup for the CLI.
  try {
    const payload = JSON.parse(input.toString("utf8"));
    // Same fallback chain as the CLI's hookPayloadProject — keep in sync.
    const candidate = payload?.cwd ?? payload?.workspace?.current_dir;
    const cwd = typeof candidate === "string" && candidate.trim() ? candidate : undefined;
    if (!cwd || !existsSync(join(cwd, ".dream", "config.json"))) process.exit(0);
  } catch {
    process.exit(0); // unparseable payload — nothing sensible to trigger
  }

  try {
    const result = spawnSync("dream", ["trigger", "--stdin"], {
      input,
      // Windows npm shims are .cmd files and need a shell to resolve.
      shell: process.platform === "win32",
      stdio: ["pipe", "inherit", "ignore"],
      timeout: 12_000,
    });
    void result;
  } catch {
    // dream not installed or failed — stay silent either way
  }
  process.exit(0);
});
