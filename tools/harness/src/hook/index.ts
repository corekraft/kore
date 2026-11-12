import type { Command } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { linkProblems } from "./skill-links.js";
import { workflowProblems } from "./workflow-permissions.js";

const skillLinks = hookCommand(
  "skill-links",
  "report skills a harness directory does not link by relative path",
  async ({ deps }) => {
    const problems = await linkProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
);

const workflowPermissions = hookCommand(
  "workflow-permissions",
  "report workflows whose token permissions break the signer guard",
  async ({ deps }) => {
    const problems = await workflowProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
);

/** The hooks the host runs as `harness hook <name>`; each is a command in this domain. */
export const hook: Record<string, Command> = {
  "skill-links": skillLinks,
  "workflow-permissions": workflowPermissions,
};
