import type { z } from "zod";

/**
 * Provider-neutral execution seam for the dreaming agents. No Claude
 * vocabulary here: tool names, permission flags, and SDK options belong to
 * concrete implementations. Future OpenAI/Codex-CLI/local runners implement
 * this same port; the pipeline consults `capabilities` to choose context
 * delivery.
 */
export interface AgentWorkspace {
  kind: "mountedDir" | "inline";
  /** mountedDir: a staging directory the agent may read (never write). */
  dir?: string;
  /** inline: documents embedded directly in the prompt. */
  inlineDocs?: { name: string; content: string }[];
}

export interface RunnerCapabilities {
  toolUse: boolean;
  jsonSchema: boolean;
  parallel: boolean;
  costMetering: boolean;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface AgentRuntime {
  provider: string;
  model: string;
  maxSteps?: number;
}

export interface RunJsonRequest<T> {
  prompt: string;
  systemPrompt: string;
  runtime: AgentRuntime;
  workspace: AgentWorkspace;
  schema: z.ZodType<T>;
  /** Label used when persisting raw output for debugging. */
  label?: string;
}

export interface RunJsonResult<T> {
  value: T;
  raw: string;
  usage: AgentUsage;
}

export interface AgentRunner {
  readonly capabilities: RunnerCapabilities;
  runJson<T>(req: RunJsonRequest<T>): Promise<RunJsonResult<T>>;
}

/**
 * Pull the last JSON document out of agent text. Fence closings are
 * line-anchored so triple-backticks INSIDE a JSON string (e.g. a memory file
 * containing a code block) don't truncate the match; candidates that fail a
 * real JSON.parse are rejected in favor of a balanced-bracket scan.
 */
export function extractJson(text: string): string {
  const candidates: string[] = [];
  const fences = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g)];
  for (const fence of fences.reverse()) candidates.push(fence[1]!.trim());
  // Bare-text fallback: collect OUTERMOST parseable documents left-to-right
  // (a parsed span is skipped over, so nested fragments never compete), then
  // prefer the LAST — agents put the final answer at the end, so prose JSON
  // earlier in the text can't shadow it.
  const outermost: string[] = [];
  for (let i = 0; i < text.length && outermost.length < 50; i++) {
    if (text[i] !== "[" && text[i] !== "{") continue;
    const span = scanBalancedJson(text, i);
    if (!span) continue;
    try {
      JSON.parse(span);
      outermost.push(span);
      i += span.length - 1;
    } catch {
      continue;
    }
  }
  for (const doc of outermost.reverse()) candidates.push(doc);
  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return candidates[0] ?? text.trim(); // let the caller surface the parse error
}

/** Find the balanced end of a JSON array/object, respecting string escapes. */
function scanBalancedJson(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "[" || ch === "{") {
      depth++;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}
