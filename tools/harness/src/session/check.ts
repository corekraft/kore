import type { CommandContext, CommandHelp } from "../runtime/index.js";
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
 * `session check`: with the role-tokens flag on, reports each writer or judge
 * pane that has no open `session spawn` record for it, because such a pane runs
 * without its token and sandbox. Read-only; exits 1 when it finds one.
 */
export async function check(context: CommandContext): Promise<number> {
  const { json, deps } = context;
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
    "Reports each writer or judge pane in Herdr that session spawn did not start, since such a pane runs without its role token and sandbox. It reports nothing when the role-tokens flag is off.",
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
      "reads the role-tokens flag, the herdr agent list and the session registry; changes nothing",
  },
  seeAlso: ["session spawn", "session close"],
};
