import type { CliDeps } from "../runtime/index.js";
import type { Terminal, Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

/** What a closed hc session settles on: when it was closed. */
export interface ClosedOnHc {
  closedAt: string;
}

/** Marks the record closed now, and returns the time. */
async function markClosed(
  deps: Pick<CliDeps, "clock">,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<ClosedOnHc> {
  const closedAt = deps.clock.now().toISOString();
  await registry.write({ ...record, closedAt });
  return { closedAt };
}

/** Why the caller may not close this terminal, or undefined when it may: its parent, then its recorded result or report. */
function refusalOf(
  target: Terminal,
  self: string,
  record: SessionRecord,
): string | undefined {
  const { name } = record;
  if (target.parent !== self) {
    return `Session ${name} runs on terminal ${target.id}, whose parent is ${target.parent ?? "none"}, not ${self}; only the terminal that spawned it may close it, so nothing was closed.`;
  }
  if (record.result === undefined && record.reportSeq === undefined) {
    return `Session ${name} has no recorded result, so terminal ${target.id} stays open. Run \`session wait ${name}\` first.`;
  }
  return undefined;
}

/** Kills the terminal when it is live; the reason it could not be killed, or undefined once it is not live. */
async function killIfLive(
  terminals: Terminals,
  target: Terminal,
): Promise<string | undefined> {
  if (target.state !== "live") {
    return undefined;
  }
  const killed = await terminals.kill(target.id);
  return "error" in killed
    ? `Session ${target.name ?? target.id} was not killed: ${hcMessage(killed)}. Nothing was removed.`
    : undefined;
}

/**
 * Writes the pane.closed event unless an earlier run wrote it, and keeps its time on the record before the removal.
 * Returns the record as marked, or the reason the event was not recorded, which keeps the terminal.
 */
async function recordOnce(
  deps: CliDeps,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  terminal: string,
): Promise<SessionRecord | { error: string }> {
  if (record.closeEventAt !== undefined) {
    return record;
  }
  const unrecorded = await recordTerminalEvent(deps, {
    kind: "pane.closed",
    pane: terminal,
    agent: record.name,
  });
  if (unrecorded !== undefined) {
    return {
      error: `Session ${record.name} was killed, but its ledger event was not recorded (${unrecorded}), so terminal ${terminal} was not removed. Run session close ${record.name} again.`,
    };
  }
  const marked = { ...record, closeEventAt: deps.clock.now().toISOString() };
  await registry.write(marked);
  return marked;
}

/**
 * `session close <name>` on hc: kills the session's terminal if it is live, writes its pane.closed ledger
 * event, then removes the terminal and marks the record closed. Only the terminal that spawned the session may
 * close it, and only once its result or report is recorded, as on herdr. The event is written once: its time is
 * kept on the record before the removal, so a removal that fails is finished by a rerun, not repeated. A terminal
 * hc no longer has means an earlier run finished the removal, so the record is only marked closed (plan 16, Step 4 (d)).
 */
export async function closeOnHc(
  deps: CliDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<ClosedOnHc | { error: string }> {
  const { name } = record;
  if (record.closedAt !== undefined) {
    return {
      error: `Session ${name} is already closed (terminal ${record.terminal}).`,
    };
  }
  const self = terminals.self();
  if (self === undefined) {
    return {
      error: `Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close ${name} was not run. Run it from the terminal that spawned the session.`,
    };
  }
  const target = await terminals.get(record.terminal ?? "");
  if ("error" in target) {
    if (target.error.kind === "not-found") {
      return await markClosed(deps, registry, record);
    }
    return { error: `Session ${name}: ${hcMessage(target)}` };
  }
  const refused = refusalOf(target, self, record);
  if (refused !== undefined) {
    return { error: refused };
  }
  const killed = await killIfLive(terminals, target);
  if (killed !== undefined) {
    return { error: killed };
  }
  const marked = await recordOnce(deps, registry, record, target.id);
  if ("error" in marked) {
    return marked;
  }
  const removed = await terminals.remove(target.id);
  if ("error" in removed) {
    return {
      error: `Session ${name} was killed and recorded, but terminal ${target.id} was not removed: ${hcMessage(removed)}.`,
    };
  }
  return await markClosed(deps, registry, marked);
}
