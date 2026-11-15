import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

/** The feature flag (ADR 0077) behind automatic approval; off unless an overlay turns it on. */
export const APPROVE_FLAG = "automatic-approval";

const ENVIRONMENT = "local";

/** Whether the local overlay turns automatic approval on. No overlay means off. */
export async function approveFlagOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[APPROVE_FLAG] === true;
}
