// Whether the local environment overlay turns a feature flag on, as the guard reads it. The guard
// reads only the local overlay, and a missing, malformed or unreadable one is off: the guard keeps
// every rule rather than fail on a flag it could not read.
import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

const FLAG_ENVIRONMENT = "local";

/** Whether the local overlay turns `flag` on; off on any failure, so the guard keeps its rules. */
export async function localFlagOn(
  fs: FileSystem,
  root: string,
  flag: string,
): Promise<boolean> {
  try {
    if (!(await environments(fs, root)).includes(FLAG_ENVIRONMENT)) {
      return false;
    }
    const overlay = await readOverlay(fs, root, FLAG_ENVIRONMENT);
    return overlay.features[flag] === true;
  } catch {
    return false;
  }
}
