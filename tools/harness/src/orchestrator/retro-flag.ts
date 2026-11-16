import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";
import { RETRO_FLAG } from "./retro-launch.js";

/** Whether the local overlay turns the automatic retro on. No overlay means off; a malformed one throws a FlagError. */
export function retroFlagOn(fs: FileSystem, root: string): Promise<boolean> {
  return localFlagOn(fs, root, RETRO_FLAG);
}
