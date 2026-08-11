import { shortId } from "./evidence.js";
import type { RunReport } from "../types.js";

export function printReport(report: RunReport): void {
  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log(
    `dream run ${report.runId}${report.dryRun ? "  [DRY RUN]" : ""}` +
      (report.partial ? "  [PARTIAL RUN]" : ""),
  );
  console.log(line);
  console.log(
    `sessions: ${report.sessionsAnalyzed.length}/${report.sessionsSelected} analyzed` +
      (report.sessionsFailed.length > 0
        ? ` — FAILED (will retry next run): ${report.sessionsFailed.map(shortId).join(", ")}`
        : ""),
  );
  const { costUsd, inputTokens, outputTokens } = report.usage;
  console.log(
    `usage: $${(costUsd ?? 0).toFixed(3)}` +
      (inputTokens ? ` · ${inputTokens} in / ${outputTokens ?? 0} out tokens` : ""),
  );

  if (report.survivingFindings.length > 0) {
    console.log(`\nfindings (${report.survivingFindings.length} after prevalence filter):`);
    for (const f of report.survivingFindings) {
      console.log(
        `  • [${f.category}] ${f.summary}` +
          `\n    seen in ${f.evidence.sessionIds.length}/${f.evidence.sessionsAnalyzed} sessions` +
          ` (${f.evidence.sessionIds.map(shortId).join(", ")})`,
      );
    }
  }

  if (report.proposals.length > 0) {
    console.log(`\nproposals (${report.proposals.length}):`);
    for (const p of report.proposals) {
      console.log(`  ${p.op.toUpperCase().padEnd(6)} ${p.path}`);
      console.log(`         why: ${p.rationale.split("\n")[0]}`);
      for (const q of p.finding.evidence.quotes.slice(0, 2)) {
        console.log(`         evidence ${shortId(q.sessionId)}: "${q.excerpt.slice(0, 90)}"`);
      }
    }
  } else {
    console.log("\nno proposals this run");
  }
  console.log(line);
}
