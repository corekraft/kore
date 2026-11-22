import type { CliDeps, CommandContext } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord } from "./registry.js";
import { reachOf } from "./send-hc-reach.js";

/** What a confirmed send to an hc session returns: its terminal, and why its ledger event was not recorded, if it was not. */
export interface SentOnHc {
  terminal: string;
  unrecorded: string | undefined;
}

/**
 * `session send <name>` on hc: one line to the session's terminal, when the caller may reach it (its parent,
 * a child, or a group sibling). hc carries the sender as its own tag, so no sender line is typed. A send that is
 * not confirmed is never resent: the caller reads the terminal first (plan 16, Step 4 (b)).
 */
export async function sendOnHc(
  deps: CliDeps,
  terminals: Terminals,
  record: SessionRecord,
  message: string,
): Promise<SentOnHc | { error: string }> {
  const { name } = record;
  const self = terminals.self();
  if (self === undefined) {
    return {
      error: `Not inside an hc terminal (HC_TERMINAL_ID is unset), so session send to ${name} was not sent. Run it from an hc terminal.`,
    };
  }
  const caller = await terminals.get(self);
  if ("error" in caller) {
    return { error: `Session ${name}: ${hcMessage(caller)}` };
  }
  const target = await terminals.get(record.terminal ?? "");
  if ("error" in target) {
    return { error: `Session ${name}: ${hcMessage(target)}` };
  }
  const reach = reachOf(caller, target);
  if (reach === undefined) {
    return {
      error: `Session ${name} is on terminal ${target.id}, which is not reachable from ${self} (not its parent, a child, or a sibling in its group), so nothing was sent.`,
    };
  }
  if (reach === "parent" && target.status === undefined) {
    return {
      error: `Session ${name}'s parent ${target.id} reports no status, so it is not an agent (a shell): a message would be typed into that shell, so nothing was sent. Its report reaches it as a file, through session report.`,
    };
  }
  const sent = await terminals.send(target.id, message);
  if ("error" in sent) {
    return {
      error: `Session ${name} was not confirmed: ${hcMessage(sent)}. Nothing was resent. Read the terminal with hc read ${target.id} before sending again.`,
    };
  }
  const unrecorded = await recordTerminalEvent(deps, {
    kind: "session.send",
    pane: target.id,
    agent: name,
    ...(caller.labels["role"] === undefined
      ? {}
      : { senderRole: caller.labels["role"] }),
    ...(caller.labels["kore-session"] === undefined
      ? {}
      : { senderName: caller.labels["kore-session"] }),
  });
  return { terminal: target.id, unrecorded };
}

/** `session send` on hc, as the command runs it: prints the send, or the reason it was refused, and returns the exit code. */
export async function sendHcCommand(
  context: CommandContext,
  terminals: Terminals,
  record: SessionRecord,
  message: string,
): Promise<number> {
  const { json, deps } = context;
  const sent = await sendOnHc(deps, terminals, record, message);
  if ("error" in sent) {
    return fail(deps, json, FAILED, sent.error);
  }
  if (sent.unrecorded !== undefined) {
    // Delivery happened, so the exit code stays 0; the missing event is said, not hidden.
    deps.stderr(
      `Sent, but the session.send event was not recorded: ${sent.unrecorded}.\n`,
    );
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ name: record.name, terminal: sent.terminal, sent: true })}\n`
      : `Sent to ${record.name} (${sent.terminal}).\n`,
  );
  return 0;
}
