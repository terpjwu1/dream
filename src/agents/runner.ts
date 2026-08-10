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
  providerMetadata?: unknown;
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

export interface TokenEstimator {
  estimate(text: string): number;
}

export const charsPerTokenEstimator: TokenEstimator = {
  estimate: (text) => Math.ceil(text.length / 4),
};

/** Pull the last ```json fence (or a bare JSON document) out of agent text. */
export function extractJson(text: string): string {
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  if (fences.length > 0) return fences[fences.length - 1]![1]!.trim();
  const trimmed = text.trim();
  const start = trimmed.search(/[[{]/);
  if (start >= 0) return trimmed.slice(start);
  return trimmed;
}
