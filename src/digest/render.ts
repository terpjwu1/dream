import type { SessionRef } from "../types.js";

export interface DigestCaps {
  userPrompt: number;
  toolError: number;
  assistantText: number;
  toolInput: number;
  toolStdout: number;
}

export type DigestEntry =
  | { kind: "user_prompt"; ts: string; text: string }
  | { kind: "assistant_text"; ts: string; text: string }
  | { kind: "tool_call"; ts: string; id: string; toolName: string; inputSummary: string }
  | {
      kind: "tool_result";
      ts: string;
      toolUseId: string;
      toolName: string;
      isError: boolean;
      interrupted: boolean;
      stdout?: string;
      stderr?: string;
    };

/** True for results carrying the failure/correction signal dreaming cares about. */
export function isSignalResult(e: Extract<DigestEntry, { kind: "tool_result" }>): boolean {
  return e.isError || e.interrupted || Boolean(e.stderr && e.stderr.trim());
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

function hhmm(ts: string): string {
  return ts ? ts.slice(11, 16) : "--:--";
}

export function renderDigest(
  ref: SessionRef,
  entries: DigestEntry[],
  meta: {
    gitBranch?: string;
    models: string[];
    stats: { userTurns: number; toolCalls: number; toolErrors: number; interrupted: number };
  },
  caps: DigestCaps,
  flags: { compacted?: boolean } = {},
): string {
  const lines: string[] = [
    `# Session ${ref.sessionId}`,
    ``,
    `- period: ${ref.startedAt.toISOString()} → ${ref.endedAt.toISOString()}`,
    `- branch: ${meta.gitBranch ?? "unknown"} · models: ${meta.models.join(", ") || "unknown"}`,
    `- stats: ${meta.stats.userTurns} user turns, ${meta.stats.toolCalls} tool calls, ` +
      `${meta.stats.toolErrors} tool errors, ${meta.stats.interrupted} interruptions`,
    ...(flags.compacted
      ? [`- note: digest compacted — successful tool activity omitted, failures kept`]
      : []),
    ``,
  ];

  for (const e of entries) {
    switch (e.kind) {
      case "user_prompt":
        lines.push(`## [${hhmm(e.ts)}] USER`, clip(e.text, caps.userPrompt), ``);
        break;
      case "assistant_text":
        lines.push(`[${hhmm(e.ts)}] assistant: ${clip(e.text, caps.assistantText)}`, ``);
        break;
      case "tool_call":
        lines.push(`[${hhmm(e.ts)}] → ${e.toolName}: ${clip(e.inputSummary, caps.toolInput)}`);
        break;
      case "tool_result": {
        const flags = [
          e.isError ? "ERROR" : null,
          e.interrupted ? "INTERRUPTED-BY-USER" : null,
        ].filter(Boolean);
        if (flags.length > 0 || (e.stderr && e.stderr.trim())) {
          // Failures are the key dreaming signal — keep generous context.
          lines.push(`[${hhmm(e.ts)}] ← ${e.toolName} ${flags.join(" ") || "stderr"}:`);
          if (e.stdout) lines.push(clip(e.stdout, caps.toolError));
          if (e.stderr?.trim()) lines.push(`stderr: ${clip(e.stderr, caps.toolError)}`);
          lines.push(``);
        } else if (e.stdout?.trim()) {
          lines.push(`[${hhmm(e.ts)}] ← ${e.toolName} ok: ${clip(e.stdout, caps.toolStdout)}`);
        } else {
          lines.push(`[${hhmm(e.ts)}] ← ${e.toolName} ok`);
        }
        break;
      }
    }
  }
  return lines.join("\n");
}
