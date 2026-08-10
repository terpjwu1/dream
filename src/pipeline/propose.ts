import { existsSync } from "node:fs";
import type { AgentRunner } from "../agents/runner.js";
import { PROPOSER_SYSTEM, proposerPrompt } from "../agents/prompts.js";
import type { Config } from "../config.js";
import { validateMemoryFile } from "../memory/frontmatter.js";
import type { FileMemoryStore } from "../memory/memoryStore.js";
import { redactSecrets } from "../redact.js";
import { RawProposalArraySchema, type Finding, type Proposal } from "../types.js";
import type { RunBudget } from "./budget.js";

export interface ProposeOutcome {
  proposals: Proposal[];
  invalid: { path: string; reason: string }[];
}

/** Ask the proposal agent for memory edits, then validate every one deterministically. */
export async function generateProposals(
  findings: Finding[],
  store: FileMemoryStore,
  runner: AgentRunner,
  config: Config,
  budget: RunBudget,
): Promise<ProposeOutcome> {
  if (findings.length === 0 || !budget.canLaunch()) return { proposals: [], invalid: [] };

  const { value, usage } = await runner.runJson({
    prompt: proposerPrompt(findings, config.steering),
    systemPrompt: PROPOSER_SYSTEM,
    runtime: {
      provider: config.runtime.provider,
      model: config.runtime.model,
      maxSteps: config.budget.maxStepsPerAgent,
    },
    workspace: { kind: "mountedDir", dir: store.root },
    schema: RawProposalArraySchema,
    label: "proposer",
  });
  budget.record(usage);

  const byId = new Map(findings.map((f) => [f.id, f]));
  const proposals: Proposal[] = [];
  const invalid: { path: string; reason: string }[] = [];

  for (const raw of value) {
    try {
      const finding = byId.get(raw.findingId);
      if (!finding) throw new Error(`references unknown finding "${raw.findingId}"`);
      if (raw.path === "MEMORY.md" || raw.path === "CHANGELOG.md") {
        throw new Error("reserved file");
      }
      const abs = store.resolvePath(raw.path); // throws on traversal
      const exists = existsSync(abs);
      if (raw.op === "create" && exists) throw new Error("create target already exists");
      if ((raw.op === "update" || raw.op === "delete") && !exists) {
        throw new Error(`${raw.op} target does not exist`);
      }
      let newContent = raw.newContent;
      if (raw.op !== "delete") {
        if (!newContent) throw new Error("missing newContent");
        newContent = redactSecrets(newContent);
        validateMemoryFile(newContent); // frontmatter + body conventions
      }
      proposals.push({
        op: raw.op,
        path: raw.path,
        newContent,
        rationale: redactSecrets(raw.rationale),
        finding: redactFinding(finding),
      });
    } catch (err: unknown) {
      invalid.push({ path: raw.path, reason: (err as Error).message });
    }
  }
  return { proposals, invalid };
}

/** Evidence excerpts end up in commit bodies and changelogs — redact them too. */
export function redactFinding(finding: Finding): Finding {
  return {
    ...finding,
    summary: redactSecrets(finding.summary),
    detail: redactSecrets(finding.detail),
    evidence: {
      ...finding.evidence,
      quotes: finding.evidence.quotes.map((q) => ({
        sessionId: q.sessionId,
        excerpt: redactSecrets(q.excerpt),
      })),
    },
  };
}
