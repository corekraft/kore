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

/** Why the session may not be closed for want of a recorded result or consumed report, or undefined when it has one. */
function unrecordedOf(
  record: SessionRecord,
  terminal: string,
): string | undefined {
  return record.result === undefined && record.reportSeq === undefined
    ? `Session ${record.name} has no recorded result, so terminal ${terminal} stays open. Run \`session wait ${record.name}\` first.`
    : undefined;
}

/** Why the caller may not close this terminal, or undefined when it may: its parent, then its recorded result or report. */
function refusalOf(
  target: Terminal,
  self: string,
  record: SessionRecord,
): string | undefined {
  if (target.parent !== self) {
    return `Session ${record.name} runs on terminal ${target.id}, whose parent is ${target.parent ?? "none"}, not ${self}; only the terminal that spawned it may close it, so nothing was closed.`;
  }
  return unrecordedOf(record, target.id);
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

/** Settles a record whose start was lost before hc made a terminal: nothing to kill or record, so it is closed as blocked. */
async function closeNeverStarted(
  deps: CliDeps,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<ClosedOnHc> {
  return await markClosed(deps, registry, {
    ...record,
    result: record.result ?? {
      outcome: "blocked",
      at: deps.clock.now().toISOString(),
      summary: "never started a terminal",
    },
  });
}

/** Finishes a close for a terminal hc no longer has: its parent cannot be checked, but the result gate still applies. */
async function closeGone(
  deps: CliDeps,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  terminal: string,
): Promise<ClosedOnHc | { error: string }> {
  const unrecorded = unrecordedOf(record, terminal);
  return unrecorded === undefined
    ? await markClosed(deps, registry, record)
    : { error: unrecorded };
}

/** Kills the permitted terminal if live, records its pane.closed event once, removes it and marks the record closed. */
async function closeLive(
  deps: CliDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
  target: Terminal,
): Promise<ClosedOnHc | { error: string }> {
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
      error: `Session ${record.name} was killed and recorded, but terminal ${target.id} was not removed: ${hcMessage(removed)}.`,
    };
  }
  return await markClosed(deps, registry, marked);
}

/**
 * `session close <name>` on hc: kills the session's terminal if it is live, writes its pane.closed ledger
 * event, then removes the terminal and marks the record closed. Only the terminal that spawned the session may
 * close it, and only once its result or report is recorded, as on herdr. The event is written once: its time is
 * kept on the record before the removal, so a removal that fails is finished by a rerun, not repeated. A terminal
 * hc no longer has means an earlier run finished the removal, so the record is only marked closed, still behind the result gate
 * (plan 16, Step 4 (d)). A record whose start never got a terminal is closed as blocked, with nothing to kill.
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
  if (record.terminal === undefined) {
    return await closeNeverStarted(deps, registry, record);
  }
  const target = await terminals.get(record.terminal);
  if ("error" in target) {
    if (target.error.kind === "not-found") {
      return await closeGone(deps, registry, record, record.terminal);
    }
    return { error: `Session ${name}: ${hcMessage(target)}` };
  }
  const refused = refusalOf(target, self, record);
  if (refused !== undefined) {
    return { error: refused };
  }
  return await closeLive(deps, terminals, registry, record, target);
}
