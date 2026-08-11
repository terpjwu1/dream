import type { Finding } from "../types.js";

/** One canonical rendering of evidence across commit bodies, changelogs, reports. */
export function shortId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

export function formatPrevalence(finding: Finding): string {
  const ev = finding.evidence;
  return `Pattern seen in ${ev.sessionIds.length}/${ev.sessionsAnalyzed} analyzed sessions.`;
}

export function formatEvidenceLines(finding: Finding): string[] {
  return finding.evidence.quotes.map(
    (q) => `Evidence: session ${shortId(q.sessionId)} — "${q.excerpt}"`,
  );
}
