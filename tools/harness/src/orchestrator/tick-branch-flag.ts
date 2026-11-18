import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";

/**
 * The flag that lets the tick tell a writer to merge origin/main; off until the owner activates it.
 * Detection runs only when this and `orchestrator-tick` are both on (#980).
 */
export const BRANCH_NOTICE_FLAG = "behind-main-notice";

/** Whether the local overlay turns the branch update notice on. */
export function branchNoticeFlagOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  return localFlagOn(fs, root, BRANCH_NOTICE_FLAG);
}
