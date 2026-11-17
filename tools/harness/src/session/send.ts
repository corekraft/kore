import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
} from "../runtime/index.js";
import { signedMessage, type Sender } from "../sender/index.js";
import { deliver } from "./notify.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";
import { signedMainSendsOn } from "./signed-sends.js";

const USAGE = "session send <name> --message <text>";

/** The sender's role and session name on the event; neither is set for a send from the main session. */
function senderFields(sender: Sender): {
  senderRole?: string;
  senderName?: string;
} {
  return sender.session === undefined
    ? {}
    : { senderRole: sender.session.role, senderName: sender.session.name };
}

/** The reason the event was not recorded, or undefined once it is. Only a ledger write failure is expected; anything else is rethrown. */
async function recordSend(
  deps: CliDeps,
  pane: string,
  name: string,
  sender: Sender,
): Promise<string | undefined> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    return "cannot find the main checkout to keep the ledger in";
  }
  try {
    const written = await new Ledger(
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
      ...senderFields(sender),
    });
    return written.ok ? undefined : written.message;
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException).code !== "string") {
      throw error;
    }
    return (error as Error).message;
  }
}

/**
 * `session send <name> --message <text>`: a follow-up to a spawned session's pane.
 * The message goes out as one line that starts with the sender line, is confirmed in the pane,
 * then is recorded as a stage event naming the sender.
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
  const signed = signedMessage(deps.env, "session send", message.trim());
  if ("error" in signed) {
    return fail(deps, json, FAILED, signed.error);
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
  const error = await deliver(deps, record.paneId, signed.body, {
    rejoinWrapped: await signedMainSendsOn(deps),
  });
  if (error !== undefined) {
    return fail(deps, json, FAILED, error);
  }
  const unrecorded = await recordSend(deps, record.paneId, name, signed.sender);
  if (unrecorded !== undefined) {
    // Delivery happened, so the exit code stays 0; the missing event is said, not hidden.
    deps.stderr(
      `Sent, but the session.send event was not recorded: ${unrecorded}. Record it with \`harness ledger record --source herdr --kind session.send --pane ${record.paneId} --agent ${name}\`.\n`,
    );
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ name, pane: record.paneId, sent: true })}\n`
      : `Sent to ${name} (${record.paneId}).\n`,
  );
  return 0;
}
