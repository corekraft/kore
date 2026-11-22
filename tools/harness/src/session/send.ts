// oxlint-disable import/max-dependencies -- send routes between two backends, so it reads the record's backend and both paths' modules
import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  mainRoot,
  type CliDeps,
  type CommandContext,
  type CommandHelp,
} from "../runtime/index.js";
import { signedMessage, type Sender } from "../sender/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import { deliver } from "./notify.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { sendHcCommand } from "./send-hc.js";
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
 * `session send <name> --message <text>`: a follow-up to a spawned session. A herdr session's message goes out as one
 * line that starts with the sender line, is confirmed in the pane, then is recorded as a stage event naming the sender.
 * An hc session's message goes to its terminal, when the caller may reach it, and hc carries the sender.
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
  const routed = routeSession(record, terminalsFor(deps));
  if ("error" in routed) {
    return fail(deps, json, FAILED, routed.error);
  }
  if (routed.backend === "hc") {
    return await sendHcCommand(
      context,
      routed.terminals,
      record,
      message.trim(),
    );
  }
  return await sendToHerdr(context, record, signed);
}

/** The herdr path: the signed line goes to the session's pane, is confirmed, then is recorded. */
async function sendToHerdr(
  context: CommandContext,
  record: SessionRecord,
  signed: Extract<ReturnType<typeof signedMessage>, { body: string }>,
): Promise<number> {
  const { json, deps, operand: name } = context;
  const error = await deliver(deps, record.paneId, signed.body, {
    rejoinWrapped: await signedMainSendsOn(deps),
  });
  if (error !== undefined) {
    return fail(deps, json, FAILED, error);
  }
  const unrecorded = await recordSend(
    deps,
    record.paneId,
    record.name,
    signed.sender,
  );
  if (unrecorded !== undefined) {
    // Delivery happened, so the exit code stays 0; the missing event is said, not hidden.
    deps.stderr(
      `Sent, but the session.send event was not recorded: ${unrecorded}. Record it with \`harness ledger record --source herdr --kind session.send --pane ${record.paneId} --agent ${record.name}\`.\n`,
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
    "Sends a one-line follow-up to a spawned session. On herdr the line goes to its pane, starts with a sender line that names who sent it, is confirmed to show in the pane, and is recorded as a session.send ledger event. On hc it goes to the session's terminal, and only when the caller is that terminal's parent, one of its children, or a sibling in its group; hc carries the sender, and a send hc does not confirm is never resent.",
  when: "When a session that is still running needs a correction, a fact or a question in its own pane, and this tool spawned it.",
  whenNot:
    "When the session is closed, which this refuses; read a finished session's result with session wait. To start new work rather than message a running session, use session spawn. For a finished hc session's report to its parent, the session uses session report. On hc, a terminal the caller cannot reach is refused, never sent to instead.",
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
        "no session of this tool has that name, the session is closed, the message cannot be signed, delivery failed or was not confirmed, or (hc) the caller may not reach the session's terminal, or it is a parent that is a shell",
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
      "herdr: types and submits one line into the session's pane, then appends a session.send ledger event that names the sender's role and session. hc: sends one line to the session's terminal and appends a session.send event with source terminal; the session registry is not changed",
  },
  seeAlso: ["session notify", "session wait", "session spawn"],
};
