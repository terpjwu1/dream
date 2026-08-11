import { ClaudeCodeSource } from "../sources/claudeCode.js";
import { digestSession } from "../digest/digester.js";
import { parseSince } from "../since.js";

export async function inspectCommand(
  projectPath: string,
  opts: { since?: string; session?: string },
): Promise<void> {
  const source = new ClaudeCodeSource();
  const since = opts.since ? parseSince(opts.since) : undefined;
  const refs = await source.listSessions(projectPath, { since });

  if (refs.length === 0) {
    console.log(`No sessions found for ${projectPath}`);
    return;
  }

  if (opts.session) {
    const ref = refs.find((r) => r.sessionId.startsWith(opts.session!));
    if (!ref) throw new Error(`No session matching "${opts.session}"`);
    const digest = await digestSession(ref, source.readSession(ref), { maxTokens: 8_000 });
    console.log(digest.markdown);
    return;
  }

  console.log(`${refs.length} session(s) for ${projectPath}\n`);
  for (const ref of refs) {
    const digest = await digestSession(ref, source.readSession(ref), { maxTokens: 8_000 });
    const kb = (ref.sizeBytes / 1024).toFixed(0).padStart(6);
    console.log(
      `${ref.sessionId.slice(0, 8)}  ${ref.endedAt.toISOString().slice(0, 16)}  ${kb}KB → ` +
        `${String(digest.approxTokens).padStart(5)} tok  ` +
        `turns=${digest.stats.userTurns} tools=${digest.stats.toolCalls} ` +
        `errors=${digest.stats.toolErrors} interrupts=${digest.stats.interrupted} ` +
        `branch=${digest.gitBranch ?? "?"}`,
    );
  }
}
