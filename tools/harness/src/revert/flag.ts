import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

/** The feature flag (ADR 0077) that lets `harness evaluate` prepare a revert; off unless an overlay turns it on. */
export const REVERT_FLAG = "automatic-revert";

const ENVIRONMENT = "local";

/** Whether the local overlay turns the automatic revert on. No overlay means off; a malformed one throws a FlagError. */
export async function revertFlagOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[REVERT_FLAG] === true;
}
