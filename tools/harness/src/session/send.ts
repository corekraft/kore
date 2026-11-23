import type { CommandContext, CommandHelp } from "../runtime/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";
import { sendHcCommand } from "./send-hc.js";

const USAGE = "session send <name> --message <text>";

/**
 * `session send <name> --message <text>`: a follow-up to a spawned session. The line goes to the session's terminal,
 * when the caller may reach it, and hc carries the sender.
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
      `Session ${name} is closed (terminal ${record.terminal ?? "none"}); nothing was sent.`,
    );
  }
  const routed = routeSession(record, terminalsFor(deps));
  if ("error" in routed) {
    return fail(deps, json, FAILED, routed.error);
  }
  return await sendHcCommand(context, routed.terminals, record, message.trim());
}

export const sendHelp: CommandHelp = {
  purpose:
    "Sends a one-line follow-up to a spawned session's terminal, and only when the caller is that terminal's parent, one of its children, or a sibling in its group. hc carries the sender, so the line is not prefixed; a send hc does not confirm is never resent.",
  when: "When a session that is still running needs a correction, a fact or a question, and this tool spawned it or it is in the caller's group.",
  whenNot:
    "When the session is closed, which this refuses; read a finished session's result with session wait. To start new work rather than message a running session, use session spawn. For a finished session's report to its parent, the session uses session report. A terminal the caller cannot reach is refused, never sent to instead.",
  flags: {
    message: "The text to send: one line, not blank, with no line break.",
  },
  operand:
    "The spawned session's name, such as image-trust-reader. A name this tool did not spawn is refused.",
  examples: [
    {
      command:
        'harness session send image-trust-reader --message "Also check the cache rule"',
      shows:
        "the line reaches the session's terminal, and the command prints that it was sent and exits 0",
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
        "no session of this tool has that name, the session is closed, the caller may not reach the session's terminal, it is a parent that is a shell, or delivery was not confirmed",
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
      "sends one line to the session's terminal and appends a session.send event; the session registry is not changed",
  },
  seeAlso: ["session wait", "session report", "session spawn"],
};
