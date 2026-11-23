import {
  mainRoot,
  type CommandContext,
  type CommandHelp,
} from "../runtime/index.js";
import { terminalsFor } from "./backend.js";
import { checkOnHc } from "./check-hc.js";
import { FAILED, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";

/**
 * `session check`: each agent terminal that session spawn did not start, and each report file with no open
 * session record. Read-only; exits 1 when it finds one.
 */
export async function check(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const main = await mainRoot(deps);
  if (main === undefined) {
    return fail(
      deps,
      json,
      FAILED,
      "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root.",
    );
  }
  const found = await checkOnHc(
    deps,
    terminalsFor(deps),
    await SessionRegistry.open(deps),
    main,
  );
  if ("error" in found) {
    return fail(
      deps,
      json,
      FAILED,
      `session check could not list the hc terminals: ${found.error}`,
    );
  }
  const clean =
    found.unmanaged.length === 0 && found.orphanReports.length === 0;
  if (json) {
    deps.stdout(`${JSON.stringify(found)}\n`);
    return clean ? 0 : FAILED;
  }
  for (const terminal of found.unmanaged) {
    deps.stderr(
      `Terminal ${terminal.terminal} runs an agent (${terminal.role ?? "no role label"}) that session spawn did not start, so it has no kore-session label. Stop it with \`hc kill ${terminal.terminal}\`, remove it with \`hc rm ${terminal.terminal}\`.\n`,
    );
  }
  for (const orphan of found.orphanReports) {
    deps.stderr(
      `Report ${orphan.file} has no open session record for ${orphan.name}; read it, then delete it.\n`,
    );
  }
  if (clean) {
    deps.stdout(
      "Every agent terminal was started by session spawn, and every report has an open record.\n",
    );
  }
  return clean ? 0 : FAILED;
}

export const checkHelp: CommandHelp = {
  purpose:
    "Reports each live agent terminal that session spawn did not start: one with no kore-session label that is under a parent, with its role from the role label. It also reports each report file with no open session record. Read-only.",
  when: "To find an agent terminal that was started by hand and must be stopped, or a report that must be read and deleted.",
  whenNot:
    "To start a session, use session spawn. To close a session this tool spawned, use session close. This command changes nothing.",
  flags: {},
  examples: [
    {
      command: "harness session check",
      shows:
        "every agent terminal was started by session spawn and every report has an open record; exit 0",
    },
    {
      command: "harness session check --json",
      shows:
        "the unmanaged terminals and orphan reports as one object, each list empty when there are none",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "no unmanaged terminal and no orphan report was found",
    },
    {
      code: 1,
      meaning:
        "an agent terminal was not started by session spawn or a report has no open record, or hc could not list its terminals",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the hc terminal list, the report files and the session registry; changes nothing",
  },
  seeAlso: ["session spawn", "session close"],
};
