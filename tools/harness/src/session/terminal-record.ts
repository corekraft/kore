// The record of the hc terminal a session runs in (plan 16, Grilled Decisions 5). An open record that names the
// terminal is the one; a closed record is named only when no open one is, so a reused id does not find a finished session.
import type { SessionRecord, SessionRegistry } from "./registry.js";

export async function recordOfTerminal(
  registry: Pick<SessionRegistry, "all">,
  terminal: string,
): Promise<SessionRecord | undefined> {
  const named = (await registry.all()).filter(
    (record) => record.terminal === terminal,
  );
  return named.find((record) => record.closedAt === undefined) ?? named[0];
}
