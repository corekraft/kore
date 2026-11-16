import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";

/** The flag that guards `orchestrate tick` and the tick-driven `orchestrate run`; off until the owner activates it. */
export const TICK_FLAG = "orchestrator-tick";

/** Whether the local overlay turns the orchestrator tick on. */
export function tickFlagOn(fs: FileSystem, root: string): Promise<boolean> {
  return localFlagOn(fs, root, TICK_FLAG);
}
