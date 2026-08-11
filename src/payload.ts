/**
 * Claude Code JSON payload parsing, shared by the trigger (SessionStart hook
 * payloads) and the statusline (statusline payloads). One precedence order
 * everywhere: workspace.current_dir first (statusline payloads carry both
 * fields and current_dir is the project), falling back to cwd (the only field
 * hook payloads carry). plugin/hooks/trigger.mjs mirrors this order — it
 * cannot import compiled src.
 */
export function projectFromPayload(payloadJson: string): string | undefined {
  try {
    const payload = JSON.parse(payloadJson);
    return (
      asProjectString(payload?.workspace?.current_dir) ?? asProjectString(payload?.cwd)
    );
  } catch {
    return undefined;
  }
}

function asProjectString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

const MAX_STDIN_BYTES = 1024 * 1024;

/** Drain stdin with a flood cap; hook/statusline payloads are tiny. */
export async function readStdinCapped(): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += (chunk as Buffer).length;
    if (bytes > MAX_STDIN_BYTES) {
      console.error(`dream: stdin payload exceeded ${MAX_STDIN_BYTES} bytes — ignoring`);
      return undefined;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
