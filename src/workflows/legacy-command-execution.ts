import { resolve } from "node:path";
import {
  runHiddenProbeIsolated,
  runRequiredCommandIsolated,
} from "../core/isolated-command-runner.ts";
import type { CommandResult } from "../core/deterministic-gate.ts";

// V1-V3 workflow compatibility only. V4 routes command execution through the
// shared finalizer so neither experiment arm can supply its own results.
export async function runRequiredCommands(
  workspace: string,
  commands: readonly string[],
  hiddenProbePath?: string | null,
  caseDir?: string,
): Promise<Record<string, CommandResult>> {
  const results: Record<string, CommandResult> = {};
  for (const command of commands) {
    results[command] = await runRequiredCommandIsolated(command, workspace);
  }
  if (hiddenProbePath) {
    if (!caseDir) throw new Error("Hidden verifier execution requires the case directory");
    results[`hidden:${hiddenProbePath}`] = await runHiddenProbeIsolated(
      workspace,
      resolve(caseDir, ...hiddenProbePath.split("/")),
    );
  }
  return results;
}
