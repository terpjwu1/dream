import { displayBadge } from "../badge.js";
import { projectFromPayload, readStdinCapped } from "../payload.js";

/** Extract the project dir from Claude Code's statusline stdin payload. */
export const statuslineProject = projectFromPayload;

/** `dream statusline` — settings.json statusLine command. Prints the badge or nothing. */
export async function statuslineCommand(): Promise<void> {
  const raw = await readStdinCapped();
  if (raw === undefined) return;
  const project = projectFromPayload(raw);
  if (!project) return;
  const badge = displayBadge(project);
  if (badge) process.stdout.write(badge);
}
