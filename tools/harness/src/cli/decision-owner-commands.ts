// The owner-facing `decision` commands (ADR 0120): `ask` posts a reserved question to the owner's
// queue. The decision group merges it in one place. `decision digest` was removed (#1787).
import type { Command } from "../runtime/index.js";
import { askCommands } from "./decision-ask-commands.js";

/** The ask command, merged into the `decision` group. */
export const ownerCommands: Record<string, Command> = {
  ...askCommands,
};
