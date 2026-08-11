#!/usr/bin/env node
// dream SessionStart hook: forward the payload to `dream trigger`, which
// decides whether to start a background dreaming run (opt-in per project).
// Cross-platform (node, not bash) and silent when the dream CLI is missing —
// a hook must never break a session.
import { spawnSync } from "node:child_process";

if (process.env.DREAM_BACKGROUND === "1") process.exit(0);

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  try {
    const result = spawnSync("dream", ["trigger", "--stdin"], {
      input: Buffer.concat(chunks),
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
