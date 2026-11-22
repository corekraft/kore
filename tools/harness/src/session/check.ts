import {
  mainRoot,
  type CommandContext,
  type CommandHelp,
} from "../runtime/index.js";
import { terminalsFor } from "./backend.js";
import { checkOnHc } from "./check-hc.js";
import { hcSessionsOn } from "./hc-flag.js";
import { FAILED, fail } from "./output.js";
import { SessionRegistry } from "./registry.js";
import { roleTokensOn } from "./role-token.js";

/** The roles that get a token and a sandbox from `session spawn`; their pane title is the role name. */
const TOKEN_ROLES = ["writer", "judge"];

interface Unmanaged {
  pane: string;
  name?: string;
  role: string;
}

/** The writer and judge panes herdr lists, or the reason it could not list them. */
async function rolePanes(
  context: CommandContext,
): Promise<Array<Unmanaged> | string> {
  const found = await context.deps.runner.run("herdr", ["agent", "list"]);
  if (found.code !== 0) {
    return `herdr agent list failed: ${found.stderr.trim() || `exit ${found.code}`}`;
  }
  let agents: unknown;
  try {
    agents = (JSON.parse(found.stdout) as { result?: { agents?: unknown } })
      .result?.agents;
  } catch {
    return "herdr agent list did not return JSON";
  }
  if (!Array.isArray(agents)) {
    return "herdr agent list returned no agents list";
  }
  const panes: Unmanaged[] = [];
  for (const agent of agents as Array<Record<string, unknown>>) {
    const role = agent["terminal_title_stripped"];
    if (typeof role === "string" && TOKEN_ROLES.includes(role)) {
      panes.push({
        pane: String(agent["pane_id"]),
        ...(typeof agent["name"] === "string" ? { name: agent["name"] } : {}),
        role,
      });
    }
  }
  return panes;
}

/**
 * `session check` on hc: each agent terminal that session spawn did not start, and each report file with no open
 * session record. Read-only; exits 1 when it finds one.
 */
async function checkHc(context: CommandContext): Promise<number> {
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

/**
 * `session check`: with the role-tokens flag on, reports each writer or judge
 * pane that has no open `session spawn` record for it, because such a pane runs
 * without its token and sandbox. Read-only; exits 1 when it finds one.
 */
export async function check(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  if (await hcSessionsOn(deps)) {
    return await checkHc(context);
  }
  if (!(await roleTokensOn(deps))) {
    deps.stdout(
      json
        ? `${JSON.stringify({ unmanaged: [], checked: false })}\n`
        : "role-tokens is off; no role pane was checked.\n",
    );
    return 0;
  }
  const panes = await rolePanes(context);
  if (typeof panes === "string") {
    return fail(deps, json, FAILED, panes);
  }
  const registry = await SessionRegistry.open(deps);
  const unmanaged: Unmanaged[] = [];
  for (const pane of panes) {
    const record =
      pane.name === undefined ? undefined : await registry.read(pane.name);
    if (
      record === undefined ||
      record.closedAt !== undefined ||
      record.paneId !== pane.pane
    ) {
      unmanaged.push(pane);
    }
  }
  if (json) {
    deps.stdout(`${JSON.stringify({ unmanaged })}\n`);
    return unmanaged.length === 0 ? 0 : FAILED;
  }
  for (const pane of unmanaged) {
    deps.stderr(
      `Pane ${pane.pane} (${pane.name ?? "unnamed"}) runs as a ${pane.role} but session spawn did not start it, so it has no role token and no sandbox. Close it with \`herdr pane close ${pane.pane}\` and start it with \`session spawn --role ${pane.role}\`.\n`,
    );
  }
  if (unmanaged.length === 0) {
    deps.stdout("Every writer and judge pane was started by session spawn.\n");
  }
  return unmanaged.length === 0 ? 0 : FAILED;
}

export const checkHelp: CommandHelp = {
  purpose:
    "Reports each writer or judge pane in Herdr that session spawn did not start, since such a pane runs without its role token and sandbox. With the role-tokens flag off it prints that no role pane was checked and exits 0; with --json it prints an object with an empty unmanaged list and checked set to false, and exits 0. With the hc-sessions flag on it lists the hc terminals instead: each live agent terminal with no kore-session label that is under a parent, with its role from the role label, and each report file with no open session record.",
  when: "With the role-tokens flag on, to find a writer or judge pane that must be closed and started again with session spawn.",
  whenNot:
    "To start a pane, use session spawn. To close a pane this tool spawned, use session close; a pane that spawn did not start is closed with herdr pane close, as the report says. This command changes nothing.",
  flags: {},
  examples: [
    {
      command: "harness session check",
      shows:
        "every writer and judge pane was started by session spawn, or role-tokens is off and no pane was checked; exit 0",
    },
    {
      command: "harness session check --json",
      shows:
        "the unmanaged panes as one object with an unmanaged list, empty when there are none",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "no unmanaged pane was found, or the role-tokens flag is off",
    },
    {
      code: 1,
      meaning:
        "a writer or judge pane was not started by session spawn, or herdr could not list its agents",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the role-tokens flag, the herdr agent list and the session registry; with hc-sessions on, the hc terminal list, the report files and the registry; changes nothing",
  },
  seeAlso: ["session spawn", "session close"],
};
