import { homedir } from "node:os";
import { join } from "node:path";
import {
  restartJobPath,
  restartJobPlist,
  tickFlagOn,
} from "../orchestrator/index.js";
import type { CliDeps } from "../runtime/index.js";

const FAILED = 1;
const HARNESS = "skills/bin/harness.mjs";

/**
 * `orchestrate tick --install`: writes the opt-in restart job for the loop, behind
 * the flag. It writes the file and starts nothing; the owner loads it with the
 * launchctl line this prints. No agent runs this command.
 */
export async function installTickJob(
  deps: CliDeps,
  root: string,
): Promise<number> {
  if (!(await tickFlagOn(deps.fs, root))) {
    deps.stderr(
      "The orchestrator-tick flag is off in the local overlay, so no restart job was written. Turn the flag on after its recorded proof, then rerun orchestrate tick --install.\n",
    );
    return FAILED;
  }
  const home = homedir();
  const path = restartJobPath(home);
  await deps.fs.writeFile(
    path,
    restartJobPlist({
      node: process.execPath,
      harness: join(root, HARNESS),
      root,
      log: join(home, "Library", "Logs", "kore-orchestrate-tick.log"),
    }),
  );
  deps.stdout(
    `Wrote ${path}. Nothing is running yet. Only the owner starts it, with: launchctl bootstrap "gui/$(id -u)" "${path}"\n`,
  );
  return 0;
}
