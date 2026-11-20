import { environments, readOverlay } from "../flag/index.js";
import type { FileSystem } from "../runtime/index.js";

/** The local flag that turns on the frontier queue, its steering view, and idea sync's harness label; off until the owner activates it. */
export const TICKET_QUEUE_FLAG = "tick-ticket-queue";

const ENVIRONMENT = "local";

/**
 * Whether the local overlay turns the frontier queue on. No overlay means off; a
 * malformed one throws a FlagError, as the other local flags do.
 */
export async function ticketQueueOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, ENVIRONMENT);
  return overlay.features[TICKET_QUEUE_FLAG] === true;
}
