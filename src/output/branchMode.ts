import type { Config } from "../config.js";
import type { RunReport } from "../types.js";

export async function applyBranchMode(
  projectPath: string,
  config: Config,
  report: RunReport,
): Promise<void> {
  throw new Error("branch mode lands in Milestone 5");
}
