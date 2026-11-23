import type { Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import type { SessionRegistry } from "./registry.js";

/** What --force-record settles on: the record it removed. */
export interface ForceRemoved {
  removed: string;
}

/**
 * `session close <name> --force-record`: removes the record file only. It is refused while the record's terminal is
 * live in hc, and so is a terminal hc cannot be asked about, since a live terminal would then be orphaned from its
 * record. A record with no terminal id never asked hc at all. Nothing is killed, and no ledger event is written.
 */
export async function forceRecordClose(
  name: string,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "read" | "remove">,
): Promise<ForceRemoved | { error: string }> {
  const record = await registry.read(name);
  if (record === undefined) {
    return {
      error: `No session record named ${name} exists, so there is nothing to remove.`,
    };
  }
  if (record.terminal !== undefined) {
    const target = await terminals.get(record.terminal);
    if ("error" in target && target.error.kind !== "not-found") {
      return {
        error: `Session ${name}: terminal ${record.terminal} could not be checked in hc (${hcMessage(target)}), so its record is kept.`,
      };
    }
    if (!("error" in target) && target.state === "live") {
      return {
        error: `Session ${name} runs on terminal ${record.terminal}, which is live in hc, so its record is kept. Close it with \`harness session close ${name}\` from the terminal that spawned it.`,
      };
    }
  }
  await registry.remove(name);
  return { removed: name };
}
