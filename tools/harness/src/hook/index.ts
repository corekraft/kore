import type { Command } from "../runtime/index.js";
import { delta } from "./delta-command.js";
import { feedback } from "./feedback.js";
import { guard } from "./guard.js";
import { hookCommand } from "./io.js";
import { retroScan } from "./retro-hook.js";
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

const feedbackHook = hookCommand(
  "feedback",
  "run the post-edit, stop or tool-failure feedback checks and record ledger events",
  ({ deps, payload, operand }) => feedback(operand, payload, deps),
  { operand: "mode" },
);

const guardHook = hookCommand(
  "guard",
  "block or warn on tool calls that break mechanically checkable rules (PreToolUse)",
  ({ deps, payload }) => guard(payload, deps),
);

/** The hooks the host runs as `harness hook <name>`; each is a command in this domain. */
export const hook: Record<string, Command> = {
  delta,
  feedback: feedbackHook,
  guard: guardHook,
  "retro-scan": retroScan,
  "skill-links": skillLinks,
  "workflow-permissions": workflowPermissions,
};
