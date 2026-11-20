import type { FileSystem } from "../runtime/index.js";
import { localFlagOn } from "./local-flag.js";

/** The flag that lets the tick work plain ready-for-agent tickets as well as ideas; off until the owner activates it. */
export const TICKET_FLAG = "tick-ticket-queue";

/** Whether the local overlay turns the tick's ticket queue on. */
export function ticketFlagOn(fs: FileSystem, root: string): Promise<boolean> {
  return localFlagOn(fs, root, TICKET_FLAG);
}
