import { ideaCommandsWith } from "../idea/index.js";
import { ticketQueueOn } from "../queue/index.js";
import type { CommandContext } from "../runtime/index.js";

/** Whether the local overlay turns the tick-ticket-queue flag on, which gives `idea sync` its harness label. */
export const harnessLabel = async (context: CommandContext) =>
  ticketQueueOn(context.deps.fs, await context.deps.root());

/** The idea commands the CLI registers: `idea sync` reads the flag from the checkout it runs in. */
export const ideaRecordCommands = ideaCommandsWith(harnessLabel);
