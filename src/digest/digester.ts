import type { SessionDigest, SessionRecord, SessionRef } from "../types.js";
import { isSignalResult, renderDigest, type DigestCaps, type DigestEntry } from "./render.js";

/** The one chars-per-token heuristic (both directions derive from it). */
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export const DEFAULT_CAPS: DigestCaps = {
  userPrompt: 2_000,
  toolError: 4_000,
  assistantText: 1_500,
  toolInput: 500,
  toolStdout: 400,
};

export interface DigestOptions {
  /** Iteratively tighten caps until the rendered digest fits this budget. */
  maxTokens?: number;
}

/**
 * Compact a session's record stream into a markdown digest for analyzer agents.
 * Keeps the high-signal material (human prompts, tool errors, interruptions),
 * truncates the rest, and drops pure noise.
 */
export async function digestSession(
  ref: SessionRef,
  records: AsyncIterable<SessionRecord> | Iterable<SessionRecord>,
  opts: DigestOptions = {},
): Promise<SessionDigest> {
  const entries: DigestEntry[] = [];
  const models = new Set<string>();
  const stats = { userTurns: 0, toolCalls: 0, toolErrors: 0, interrupted: 0 };
  let gitBranch: string | undefined;
  const pendingToolNames = new Map<string, string>();

  for await (const rec of records as AsyncIterable<SessionRecord>) {
    switch (rec.kind) {
      case "user_prompt":
        stats.userTurns++;
        entries.push({ kind: "user_prompt", ts: rec.ts, text: rec.text });
        break;
      case "assistant_text":
        models.add(rec.model);
        entries.push({ kind: "assistant_text", ts: rec.ts, text: rec.text });
        break;
      case "tool_call": {
        stats.toolCalls++;
        pendingToolNames.set(rec.id, rec.toolName);
        entries.push({
          kind: "tool_call",
          ts: rec.ts,
          id: rec.id,
          toolName: rec.toolName,
          inputSummary: summarizeToolInput(rec.toolName, rec.input),
        });
        break;
      }
      case "tool_result": {
        const toolName = pendingToolNames.get(rec.toolUseId) ?? "unknown";
        if (rec.interrupted) stats.interrupted++;
        if (rec.isError || (rec.stderr && rec.stderr.trim())) stats.toolErrors++;
        entries.push({
          kind: "tool_result",
          ts: rec.ts,
          toolUseId: rec.toolUseId,
          toolName,
          isError: rec.isError,
          interrupted: rec.interrupted === true,
          stdout: rec.stdout,
          stderr: rec.stderr,
        });
        break;
      }
      case "meta":
        if (rec.raw.gitBranch && !gitBranch) gitBranch = rec.raw.gitBranch;
        break;
    }
  }

  const meta = { gitBranch, models: [...models], stats };
  let kept = entries;
  let caps = { ...DEFAULT_CAPS };
  let markdown = renderDigest(ref, kept, meta, caps);

  if (opts.maxTokens) {
    const fits = () => estimateTokens(markdown) <= opts.maxTokens!;

    // Pass 1: shrink per-entry caps by the measured overage ratio in ONE step
    // (with floors), instead of iterating geometric decay with a full O(N)
    // re-render per iteration.
    if (!fits()) {
      const ratio = Math.min(
        1,
        (opts.maxTokens * CHARS_PER_TOKEN) / Math.max(1, markdown.length),
      ) * 0.9; // 10% slack for per-entry overhead the caps don't control
      caps = {
        userPrompt: Math.max(200, Math.floor(caps.userPrompt * ratio)),
        toolError: Math.max(200, Math.floor(caps.toolError * ratio)),
        assistantText: Math.max(150, Math.floor(caps.assistantText * ratio)),
        toolInput: Math.max(80, Math.floor(caps.toolInput * ratio)),
        toolStdout: Math.max(60, Math.floor(caps.toolStdout * ratio)),
      };
      markdown = renderDigest(ref, kept, meta, caps);
    }

    // Pass 2: entry-count dominates on huge sessions — evict low-signal
    // entries, keeping prompts, failures, and the calls that caused them.
    if (!fits()) {
      const errorIds = new Set(
        kept
          .filter((e): e is Extract<DigestEntry, { kind: "tool_result" }> =>
            e.kind === "tool_result" ? isSignalResult(e) : false,
          )
          .map((e) => e.toolUseId),
      );
      kept = kept.filter(
        (e) =>
          e.kind === "user_prompt" ||
          e.kind === "assistant_text" ||
          (e.kind === "tool_result" && isSignalResult(e)) ||
          (e.kind === "tool_call" && errorIds.has(e.id)),
      );
      markdown = renderDigest(ref, kept, meta, caps, { compacted: true });
    }

    // Pass 3: thin assistant commentary from the middle (keep the narrative
    // opening and the conclusions).
    if (!fits()) {
      const texts = kept.filter((e) => e.kind === "assistant_text");
      if (texts.length > 20) {
        const keepSet = new Set([...texts.slice(0, 10), ...texts.slice(-10)]);
        kept = kept.filter((e) => e.kind !== "assistant_text" || keepSet.has(e));
        markdown = renderDigest(ref, kept, meta, caps, { compacted: true });
      }
    }

    // Last resort: hard clip so one monster session can never blow the batch.
    // Plain slice can split a surrogate pair at the boundary; accept the
    // 1-char blemish rather than a code-point dance.
    if (!fits()) {
      const marker = "\n…[digest hard-clipped at token budget]";
      const budgetChars = Math.max(0, opts.maxTokens * CHARS_PER_TOKEN - marker.length);
      markdown = markdown.slice(0, budgetChars) + marker;
    }
  }

  return {
    sessionId: ref.sessionId,
    startedAt: ref.startedAt.toISOString(),
    endedAt: ref.endedAt.toISOString(),
    gitBranch,
    models: [...models],
    stats,
    markdown,
    approxTokens: estimateTokens(markdown),
  };
}

/** Always keep the tool name; for Bash keep the command itself (high signal). */
export function summarizeToolInput(toolName: string, input: unknown): string {
  if (toolName === "Bash" && input && typeof input === "object") {
    const { command, description } = input as { command?: string; description?: string };
    return command ? `${command}${description ? `  # ${description}` : ""}` : JSON.stringify(input);
  }
  try {
    return JSON.stringify(input) ?? "";
  } catch {
    return String(input);
  }
}
