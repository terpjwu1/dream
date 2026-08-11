import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema, configPaths } from "../config.js";
import { currentBranch, git, isGitRepo } from "../git.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { defaultMemoryDir } from "../paths.js";

export async function initCommand(
  projectPath: string,
  opts: { mode?: string },
): Promise<void> {
  const mode = opts.mode === "auto" ? "auto" : "branch";
  const paths = configPaths(projectPath);

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

  // 2. Ensure the memory store exists.
  const memoryDir = defaultMemoryDir(projectPath);
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
      await git(memoryDir, "init", "-b", "main");
      await git(memoryDir, "add", "-A");
      await git(memoryDir, "commit", "-m", "dream init: memory store baseline");
      console.log(`initialized git repo in ${memoryDir} (baseline committed)`);
    }
  }

  console.log(`\nready — try: dream run --project ${projectPath} --dry-run`);
}
