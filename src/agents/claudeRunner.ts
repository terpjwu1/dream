import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  extractJson,
  type AgentRunner,
  type AgentUsage,
  type RunJsonRequest,
  type RunJsonResult,
  type RunnerCapabilities,
} from "./runner.js";

/**
 * v1 runner on the Claude Agent SDK. All SDK-specific vocabulary (tool names,
 * permission modes, option names — verified against sdk.d.ts 0.3.226) is
 * confined to this file.
 */
export class ClaudeAgentRunner implements AgentRunner {
  readonly capabilities: RunnerCapabilities = {
    toolUse: true,
    jsonSchema: false, // we enforce schemas ourselves via zod + one retry
    parallel: true,
    costMetering: true,
  };

  constructor(private readonly opts: { debugDir?: string } = {}) {}

  async runJson<T>(req: RunJsonRequest<T>): Promise<RunJsonResult<T>> {
    const basePrompt = this.buildPrompt(req);
    let lastError = "";
    let raw = "";
    const usage: AgentUsage = { costUsd: 0 };

    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nYour previous output could not be parsed against the expected JSON schema:\n${lastError}\nPrevious output (truncated):\n${raw.slice(0, 2_000)}\n\nOutput ONLY the corrected JSON in a single \`\`\`json fence.`;

      const result = await this.queryOnce(prompt, req);
      raw = result.text;
      if (result.usage.costUsd !== undefined) {
        usage.costUsd = (usage.costUsd ?? 0) + result.usage.costUsd;
      }
      usage.inputTokens = (usage.inputTokens ?? 0) + (result.usage.inputTokens ?? 0);
      usage.outputTokens = (usage.outputTokens ?? 0) + (result.usage.outputTokens ?? 0);

      try {
        const parsed = req.schema.parse(JSON.parse(extractJson(raw)));
        return { value: parsed, raw, usage };
      } catch (err: unknown) {
        lastError = (err as Error).message.slice(0, 1_500);
        this.persistInvalid(req.label ?? "agent", attempt, raw, lastError);
      }
    }
    throw new Error(
      `Agent output failed schema validation after retry (${req.label ?? "agent"}): ${lastError}`,
    );
  }

  private buildPrompt(req: RunJsonRequest<unknown>): string {
    if (req.workspace.kind === "inline") {
      const docs = (req.workspace.inlineDocs ?? [])
        .map((d) => `<document name="${d.name}">\n${d.content}\n</document>`)
        .join("\n\n");
      return `${docs}\n\n${req.prompt}`;
    }
    return req.prompt;
  }

  private async queryOnce(
    prompt: string,
    req: RunJsonRequest<unknown>,
  ): Promise<{ text: string; usage: AgentUsage }> {
    const mounted = req.workspace.kind === "mountedDir";
    const response = query({
      prompt,
      options: {
        model: req.runtime.model,
        systemPrompt: req.systemPrompt,
        cwd: mounted ? req.workspace.dir : undefined,
        // Sandbox, two layers: `tools` RESTRICTS what exists (allowedTools
        // only auto-approves — per sdk.d.ts it does not limit availability),
        // and dontAsk denies anything not pre-approved.
        tools: mounted ? ["Read", "Grep", "Glob"] : [],
        allowedTools: mounted ? ["Read", "Grep", "Glob"] : [],
        permissionMode: "dontAsk",
        maxTurns: req.runtime.maxSteps ?? 25,
        settingSources: [], // do not inherit the user's CLAUDE.md/hooks/skills
      },
    });

    let text = "";
    const usage: AgentUsage = {};
    for await (const message of response) {
      if (message.type === "result") {
        if (message.subtype === "success") text = message.result;
        usage.costUsd = message.total_cost_usd;
        // modelUsage covers sub-calls too; sdk.d.ts marks it the correct
        // accounting source (message.usage is main-loop only).
        const models = Object.values(message.modelUsage ?? {}) as Array<{
          inputTokens?: number;
          outputTokens?: number;
        }>;
        usage.inputTokens = models.reduce((s, m) => s + (m.inputTokens ?? 0), 0);
        usage.outputTokens = models.reduce((s, m) => s + (m.outputTokens ?? 0), 0);
        if (message.subtype !== "success") {
          throw new Error(`Agent run failed: ${message.subtype}`);
        }
      }
    }
    return { text, usage };
  }

  private persistInvalid(label: string, attempt: number, raw: string, error: string): void {
    if (!this.opts.debugDir) return;
    try {
      mkdirSync(this.opts.debugDir, { recursive: true });
      writeFileSync(
        join(this.opts.debugDir, `invalid-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}-attempt${attempt}.txt`),
        `# schema error\n${error}\n\n# raw output\n${raw}\n`,
        "utf8",
      );
    } catch {
      // debugging aid only — never fail the run over it
    }
  }
}
