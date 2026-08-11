import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryDirFor, type Config } from "../config.js";
import { git, isGitRepo } from "../git.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { redactSecrets } from "../redact.js";
import { formatEvidenceLines, formatPrevalence } from "./evidence.js";
import type { Proposal, RunReport } from "../types.js";

/**
 * Auto-mode output: apply proposals directly and append an auditable
 * CHANGELOG entry. The prior file content is embedded so any change can be
 * reverted by hand without git.
 */
export async function applyAutoMode(
  projectPath: string,
  config: Config,
  report: RunReport,
): Promise<void> {
  const memoryDir = memoryDirFor(projectPath, config);
  const store = new FileMemoryStore(memoryDir);

  const entries: string[] = [
    `## ${new Date().toISOString().slice(0, 10)} run ${report.runId} (auto)`,
  ];

  for (const proposal of report.proposals) {
    const prior = priorContent(memoryDir, proposal);
    await store.apply(proposal);
    entries.push("", ...changelogEntry(proposal, prior));
  }
  await store.regenerateIndex();
  appendFileSync(join(memoryDir, "CHANGELOG.md"), redactSecrets(entries.join("\n")) + "\n\n", "utf8");

  // Belt and suspenders: if the store happens to be a git repo, snapshot the run.
  if (await isGitRepo(memoryDir)) {
    await git(memoryDir, "add", "-A");
    await git(memoryDir, "commit", "-m", `dream: auto-apply run ${report.runId} (${report.proposals.length} proposals)`);
  }

  console.log(
    `\n${report.proposals.length} proposal(s) applied to ${memoryDir}\n` +
      `audit log: ${join(memoryDir, "CHANGELOG.md")}`,
  );
}

function priorContent(memoryDir: string, p: Proposal): string | undefined {
  if (p.op === "create") return undefined;
  const abs = join(memoryDir, p.path);
  return existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
}

function changelogEntry(p: Proposal, prior: string | undefined): string[] {
  const lines = [
    `### ${p.op} ${p.path}`,
    `Why: ${p.rationale}`,
    formatPrevalence(p.finding),
    ...formatEvidenceLines(p.finding),
  ];
  if (prior !== undefined) {
    lines.push(
      "<details><summary>Previous content (for revert)</summary>",
      "",
      "```markdown",
      prior.trimEnd(),
      "```",
      "",
      "</details>",
    );
  }
  return lines;
}
