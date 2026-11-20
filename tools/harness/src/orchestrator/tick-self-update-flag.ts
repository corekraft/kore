import { localFlagOn } from "./local-flag.js";
import type { FileSystem } from "../runtime/index.js";

/** The flag that lets the tick pull and rebuild a clean main between passes; off until the owner activates it. */
export const TICK_SELF_UPDATE_FLAG = "tick-self-update";

/** Whether the local overlay turns the tick's self-update on. */
export function tickSelfUpdateOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  return localFlagOn(fs, root, TICK_SELF_UPDATE_FLAG);
}
