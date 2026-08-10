import type { AgentUsage } from "../agents/runner.js";
import type { Config } from "../config.js";

/** Accumulates usage across all agent calls; gates new launches at the cap. */
export class RunBudget {
  private costUsd = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private aborted = false;

  constructor(private readonly maxCostUsd: number) {}

  static fromConfig(config: Config): RunBudget {
    return new RunBudget(config.budget.maxRunCostUsd);
  }

  record(usage: AgentUsage): void {
    this.costUsd += usage.costUsd ?? 0;
    this.inputTokens += usage.inputTokens ?? 0;
    this.outputTokens += usage.outputTokens ?? 0;
    if (this.costUsd >= this.maxCostUsd) this.aborted = true;
  }

  /** False once the cap is crossed — callers must not launch new agents. */
  canLaunch(): boolean {
    return !this.aborted;
  }

  wasAborted(): boolean {
    return this.aborted;
  }

  snapshot(): { costUsd: number; inputTokens: number; outputTokens: number } {
    return {
      costUsd: this.costUsd,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}

/** Minimal bounded-concurrency pool (avoids a dependency for one primitive). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
