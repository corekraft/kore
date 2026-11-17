// The owner-facing `decision` commands (ADR 0120): `ask` posts a reserved question, and `digest`
// reports the open ones to the owner once a day. The decision group merges them in one place.
import type { Command } from "../runtime/index.js";
import { askCommands } from "./decision-ask-commands.js";
import { digestCommands } from "./decision-digest-commands.js";

/** The ask and digest commands, merged into the `decision` group. */
export const ownerCommands: Record<string, Command> = {
  ...askCommands,
  ...digestCommands,
};
