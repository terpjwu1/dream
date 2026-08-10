import type { Config } from "../config.js";
import type { RunReport } from "../types.js";

export async function applyAutoMode(
  projectPath: string,
  config: Config,
  report: RunReport,
): Promise<void> {
  throw new Error("auto mode lands in Milestone 5");
}
