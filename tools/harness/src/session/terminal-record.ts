// The record of the hc terminal a session runs in (plan 16, Grilled Decisions 5). An open record that names the
// terminal is the one; a closed record is named only when no open one is, so a reused id does not find a finished session.
// The record file that names the terminal but cannot be read is reported too, so the caller can say so.
import type {
  SessionRecord,
  SessionRegistry,
  UnreadableRecord,
} from "./registry.js";

export interface TerminalRecords {
  /** The record that names the terminal; undefined when none does. */
  record: SessionRecord | undefined;
  /** The record files that name the terminal and cannot be read. */
  unreadable: UnreadableRecord[];
}

export async function recordsOfTerminal(
  registry: Pick<SessionRegistry, "all">,
  terminal: string,
): Promise<TerminalRecords> {
  const listed = await registry.all();
  const named = listed.records.filter((record) => record.terminal === terminal);
  return {
    record: named.find((record) => record.closedAt === undefined) ?? named[0],
    unreadable: listed.unreadable.filter((file) => file.terminal === terminal),
  };
}
