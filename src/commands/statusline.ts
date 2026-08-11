import { displayBadge } from "../badge.js";

/** Extract the project dir from Claude Code's statusline stdin payload. */
export function statuslineProject(payloadJson: string): string | undefined {
  try {
    const payload = JSON.parse(payloadJson);
    const candidate = payload?.workspace?.current_dir ?? payload?.cwd;
    return typeof candidate === "string" && candidate.trim() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** `dream statusline` — settings.json statusLine command. Prints the badge or nothing. */
export async function statuslineCommand(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const project = statuslineProject(Buffer.concat(chunks).toString("utf8"));
  if (!project) return;
  const badge = displayBadge(project);
  if (badge) process.stdout.write(badge);
}
