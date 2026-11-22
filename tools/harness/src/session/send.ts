import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
  type CommandHelp,
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

export const sendHelp: CommandHelp = {
  purpose:
    "Sends a one-line follow-up to a spawned session's pane. The line starts with a sender line that names who sent it, is confirmed to show in the pane, and is then recorded as a session.send ledger event that names the sender.",
  when: "When a session that is still running needs a correction, a fact or a question in its own pane, and this tool spawned it.",
  whenNot:
    "When the session is closed, which this refuses; read a finished session's result with session wait. To start new work rather than message a running session, use session spawn. For the session's own message to its caller, use session notify.",
  flags: {
    message:
      "The text to send: one line, not blank, with no line break. It goes out after the sender line.",
  },
  operand:
    "The spawned session's name, such as image-trust-reader. A name this tool did not spawn is refused.",
  examples: [
    {
      command:
        'harness session send image-trust-reader --message "Also check the cache rule"',
      shows:
        "the line reaches the session's pane, and the command prints that it was sent and exits 0",
    },
    {
      command: "harness session send image-trust-reader",
      shows: "the message is missing, so the command exits 2 and sends nothing",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the line was delivered and confirmed; if its ledger event could not be recorded, stderr says so and the exit stays 0",
    },
    {
      code: 1,
      meaning:
        "no session of this tool has that name, the session is closed, the message cannot be signed, or delivery failed or was not confirmed",
    },
    {
      code: 2,
      meaning:
        "a usage error: no name, or the message is missing, blank or spans lines; nothing is sent",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "types and submits one line into the session's pane, then appends a session.send ledger event that names the sender's role and session; the session registry is not changed",
  },
  seeAlso: ["session notify", "session wait", "session spawn"],
};
