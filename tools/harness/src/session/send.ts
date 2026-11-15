import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
} from "../runtime/index.js";
import { withFollowUpPrefix } from "./follow-up-prefix.js";
import { deliver } from "./notify.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";

const USAGE = "session send <name> --message <text>";

/** Appends a session.send event for the target. Best effort: a ledger problem never fails the send. */
async function recordSend(deps: CliDeps, pane: string, name: string) {
  try {
    const main = await mainRoot(deps);
    if (main === undefined) {
      return;
    }
    await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).record({
      source: "herdr",
      kind: "session.send",
      occurredAt: deps.clock.now().toISOString(),
      pane,
      agent: name,
    });
  } catch {
    // The ledger is a measurement; it never gates a send.
  }
}

/**
 * `session send <name> --message <text>`: a follow-up to a spawned session's pane.
 * The message carries the follow-up prefix once, is confirmed in the pane, then recorded as a stage event.
 */
export async function send(context: CommandContext): Promise<number> {
  const { json, deps, operand: name, options } = context;
  const message = options["message"];
  if (
    name === undefined ||
    typeof message !== "string" ||
    message.trim() === "" ||
    /[\r\n]/.test(message)
  ) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      `Missing session name, or the message is missing, blank or spans lines: ${USAGE}, with one line of text.`,
    );
  }
  const record = await (await SessionRegistry.open(deps)).read(name);
  if (record === undefined) {
    return fail(
      deps,
      json,
      FAILED,
      `No session named ${name}. Spawn it with \`session spawn\`, or check the name.`,
    );
  }
  if (record.closedAt !== undefined) {
    return fail(
      deps,
      json,
      FAILED,
      `Session ${name} is closed (pane ${record.paneId}); nothing was sent.`,
    );
  }
  const error = await deliver(deps, record.paneId, withFollowUpPrefix(message));
  if (error !== undefined) {
    return fail(deps, json, FAILED, error);
  }
  await recordSend(deps, record.paneId, name);
  deps.stdout(
    json
      ? `${JSON.stringify({ name, pane: record.paneId, sent: true })}\n`
      : `Sent to ${name} (${record.paneId}).\n`,
  );
  return 0;
}
