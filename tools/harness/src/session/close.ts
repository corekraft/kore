import type { CommandContext, CommandHelp } from "../runtime/index.js";
import { routeSession, terminalsFor } from "./backend.js";
import { closeHcSession } from "./close-hc-command.js";
import { forceRecordClose } from "./close-force-record.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";

/** `session close <name> --force-record`: removes the record file only, refused while its terminal is live in hc. */
async function closeForced(
  context: CommandContext,
  name: string,
): Promise<number> {
  const { json, deps } = context;
  const registry = await SessionRegistry.open(deps);
  const removed = await forceRecordClose(name, terminalsFor(deps), registry);
  if ("error" in removed) {
    return fail(deps, json, FAILED, removed.error);
  }
  deps.stdout(
    json
      ? `${JSON.stringify(removed)}\n`
      : `Removed the record of ${name}; its terminal, if any, was not live in hc.\n`,
  );
  return 0;
}

/** An hc record whose start was lost before it got a terminal: routing would refuse it with this command, so close settles it itself. */
function neverStarted(record: SessionRecord): boolean {
  return (
    record.backend === "hc" &&
    record.starting === true &&
    record.terminal === undefined
  );
}

/** `session close <name>`: kills the session's terminal from the terminal that spawned it, once its result is recorded. */
export async function close(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const name = context.operand;
  if (name === undefined) {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the session name: session close <name>.",
    );
  }
  const nameError = sessionNameError(name);
  if (nameError !== undefined) {
    return fail(deps, json, USAGE_ERROR, nameError);
  }
  if (context.options["force-record"] === true) {
    return await closeForced(context, name);
  }
  const terminals = terminalsFor(deps);
  const registry = await SessionRegistry.open(deps);
  const found = await registry.read(name);
  if (found === undefined) {
    return fail(
      deps,
      json,
      FAILED,
      `This tool did not create a session named ${name}, so it will not close one.`,
    );
  }
  if (neverStarted(found)) {
    return await closeHcSession(context, terminals, registry, found);
  }
  const routed = routeSession(found, terminals);
  if ("error" in routed) {
    return fail(deps, json, FAILED, routed.error);
  }
  return await closeHcSession(context, routed.terminals, registry, found);
}

export const closeHelp: CommandHelp = {
  purpose:
    "Closes a spawned session once its result is recorded: kills its hc terminal and removes it, from the terminal that spawned the session, after writing a pane.closed ledger event; it refuses a terminal the caller did not spawn. --force-record removes a session's record file only, and is refused while the record's terminal is live in hc.",
  when: "Last, once session wait has recorded the session's outcome and the terminal is no longer needed, from the terminal that spawned the session.",
  whenNot:
    "When no result is recorded yet, which this refuses: run session wait first. When the terminal was started by hand, or from a terminal other than the spawning one, which this also refuses. To list unmanaged agent terminals, use session check.",
  flags: {
    "remove-worktree":
      "Not on hc yet: refused before anything is killed. Close the session without it, then remove its worktree with git once its pull request is merged.",
    "force-record":
      "Removes the session's record file only, and nothing in hc or the worktree. Refused while the record's terminal is live in hc, or while hc cannot say whether it is; a record with no terminal id is removed without asking hc. Use it for a record that has no terminal id, which session close and the other session tools refuse.",
  },
  operand:
    "The spawned session's name, such as image-trust-reader. Only the terminal that spawned the session may close it.",
  examples: [
    {
      command: "harness session close image-trust-reader",
      shows:
        "the terminal is killed and removed and the command prints Closed image-trust-reader; exit 0",
    },
    {
      command: "harness session close image-trust-reader --force-record",
      shows:
        "the record file is removed when its terminal is not live in hc; exit 0",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the terminal is closed and recorded, or the record is removed by --force-record",
    },
    {
      code: 1,
      meaning:
        "refused: already closed, not spawned by this tool, no recorded result, not the caller's child, --remove-worktree, a record whose terminal is live in hc, or hc could not be asked",
    },
    {
      code: 2,
      meaning: "a usage error: no name, or an invalid name",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "kills the session's hc terminal, appends a pane.closed ledger event, removes the terminal and records closedAt; --force-record removes only the record file",
  },
  seeAlso: ["session wait", "session check"],
};
