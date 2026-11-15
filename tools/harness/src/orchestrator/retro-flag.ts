import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";
import { RETRO_FLAG } from "./retro-launch.js";

const ENVIRONMENT = "local";

/** Whether the local overlay turns the automatic retro on. No overlay means off; a malformed one throws a FlagError. */
export async function retroFlagOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[RETRO_FLAG] === true;
}
