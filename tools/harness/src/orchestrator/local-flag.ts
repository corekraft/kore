import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

const ENVIRONMENT = "local";

/** Whether the local overlay sets `flag` to true. No overlay means off; a malformed one throws a FlagError. */
export async function localFlagOn(
  fs: FileSystem,
  root: string,
  flag: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[flag] === true;
}
