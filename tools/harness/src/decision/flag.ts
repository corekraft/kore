import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { DECISION_FLAG } from "./decision.js";

const ENVIRONMENT = "local";

/** Whether the local overlay turns the advisor on. No overlay means off; a malformed one throws a FlagError. */
export async function decisionFlagOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[DECISION_FLAG] === true;
}
