import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigSchema, configPaths, loadConfig, memoryDirFor } from "../config.js";
import { currentBranch, initRepoWithBaseline, isGitRepo } from "../git.js";
import { FileMemoryStore } from "../memory/memoryStore.js";

export async function initCommand(
  projectPath: string,
  opts: { mode?: string; global?: boolean },
): Promise<void> {
  const mode = opts.mode === "auto" ? "auto" : "branch";
  const paths = configPaths(projectPath);

  if (opts.global) {
    const globalPath = paths.global;
    mkdirSync(dirname(globalPath), { recursive: true });
    const existing = existsSync(globalPath)
      ? JSON.parse(readFileSync(globalPath, "utf8"))
      : {};
    const merged = {
      ...existing,
      trigger: {
        ...(existing.trigger ?? {}),
        enabled: true,
        global: true,
        excludeProjects: existing.trigger?.excludeProjects ?? [],
      },
    };
    writeFileSync(globalPath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`wrote ${globalPath}`);
    console.log(
      "GLOBAL ambient dreaming enabled: EVERY project you open in Claude Code becomes\n" +
        "dreamable once ≥3 sessions are un-dreamed — each run capped at budget.maxRunCostUsd\n" +
        `(default $5), but N projects can each spend that. Carve-outs: add path substrings\n` +
        `to trigger.excludeProjects in ${globalPath}.\n` +
        "Per-project .dream/config.json still overrides everything, and memory stores are\n" +
        "auto-created on a project's first dream. Disable any time: set trigger.global to false.",
    );
    return;
  }

  // 1. Scaffold project config (full defaults so every knob is discoverable).
  if (existsSync(paths.project)) {
    console.log(`config exists: ${paths.project} (leaving it alone)`);
  } else {
    const defaults = ConfigSchema.parse({ reviewMode: mode });
    mkdirSync(join(projectPath, ".dream"), { recursive: true });
    writeFileSync(paths.project, JSON.stringify(defaults, null, 2) + "\n");
    console.log(`wrote ${paths.project}`);
    console.log(`  → edit "steering" to tell dream what matters in this project`);
    console.log(
      `  → ambient dreaming is OFF by default; set "trigger": {"enabled": true} to let ` +
        `session starts dream in the background (costs capped by budget.maxRunCostUsd)`,
    );
  }

  // 2. Ensure the memory store exists (honors a custom config.memory.dir).
  const memoryDir = memoryDirFor(projectPath, loadConfig(projectPath));
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
    console.log(`created memory dir ${memoryDir}`);
  }
  const store = new FileMemoryStore(memoryDir);
  if (!existsSync(join(memoryDir, "MEMORY.md"))) {
    await store.regenerateIndex();
    console.log(`created ${join(memoryDir, "MEMORY.md")}`);
  }

  // 3. Branch mode needs the memory dir under git.
  if (mode === "branch") {
    if (await isGitRepo(memoryDir)) {
      console.log(`memory dir already a git repo (branch: ${await currentBranch(memoryDir)})`);
    } else {
      await initRepoWithBaseline(memoryDir, "dream init: memory store baseline");
      console.log(`initialized git repo in ${memoryDir} (baseline committed)`);
    }
  }

  console.log(`\nready — try: dream run --project ${projectPath} --dry-run`);
}
