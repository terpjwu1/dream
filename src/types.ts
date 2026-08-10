import { z } from "zod";

/** Normalized transcript record — every TranscriptSource adapter maps into this. */
export type SessionRecord =
  | { kind: "user_prompt"; text: string; ts: string; uuid: string }
  | { kind: "assistant_text"; text: string; model: string; ts: string; uuid: string }
  | { kind: "tool_call"; toolName: string; input: unknown; id: string; ts: string }
  | {
      kind: "tool_result";
      toolUseId: string;
      isError: boolean;
      stdout?: string;
      stderr?: string;
      interrupted?: boolean;
      ts: string;
    }
  | { kind: "meta"; ts: string; raw: { type: string } };

export interface SessionRef {
  sessionId: string;
  filePath: string;
  startedAt: Date;
  endedAt: Date;
  sizeBytes: number;
  projectPath: string;
}

export interface SessionDigest {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  gitBranch?: string;
  models: string[];
  stats: { userTurns: number; toolCalls: number; toolErrors: number; interrupted: number };
  markdown: string;
  approxTokens: number;
}

export const EvidenceSchema = z.object({
  sessionIds: z.array(z.string()).min(1),
  sessionsAnalyzed: z.number().int().nonnegative().default(0),
  quotes: z.array(z.object({ sessionId: z.string(), excerpt: z.string() })).min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingCategorySchema = z.enum([
  "recurring_failure",
  "missing_knowledge",
  "stale_memory",
  "tool_failure",
  "workflow_pattern",
  "style_pattern",
]);

export const FindingSchema = z.object({
  id: z.string(),
  category: FindingCategorySchema,
  summary: z.string(),
  detail: z.string(),
  evidence: EvidenceSchema,
  relatedMemoryFiles: z.array(z.string()).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;

export const FindingArraySchema = z.array(FindingSchema);

export const ProposalOpSchema = z.enum(["create", "update", "delete"]);

/** Shape emitted by the proposal agent (findingId resolved to a Finding by the harness). */
export const RawProposalSchema = z.object({
  op: ProposalOpSchema,
  path: z.string(),
  newContent: z.string().optional(),
  rationale: z.string(),
  findingId: z.string(),
});
export type RawProposal = z.infer<typeof RawProposalSchema>;
export const RawProposalArraySchema = z.array(RawProposalSchema);

export interface Proposal {
  op: z.infer<typeof ProposalOpSchema>;
  path: string;
  newContent?: string;
  rationale: string;
  finding: Finding;
}

export interface RunReport {
  runId: string;
  projectPath: string;
  sessionsSelected: number;
  sessionsAnalyzed: string[];
  sessionsFailed: string[];
  findings: Finding[];
  survivingFindings: Finding[];
  proposals: Proposal[];
  usage: { costUsd?: number; inputTokens?: number; outputTokens?: number };
  partial: boolean;
  dryRun: boolean;
}
