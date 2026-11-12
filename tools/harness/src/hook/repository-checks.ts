// The hooks that check the repository itself and read no host payload.
import { linkProblems } from "./skill-links.js";
import { workflowProblems } from "./workflow-permissions.js";
import { hookCommand } from "./io.js";
import { kbCheck } from "./kb-check.js";

export const skillLinks = hookCommand(
  "skill-links",
  "report skills a harness directory does not link by relative path",
  async ({ deps }) => {
    const problems = await linkProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
);

export const workflowPermissions = hookCommand(
  "workflow-permissions",
  "report workflows whose token permissions break the signer guard",
  async ({ deps }) => {
    const problems = await workflowProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
);

export const kbCheckHook = hookCommand(
  "kb-check",
  "report knowledge-base problems: links, the index, frontmatter, markers and README coverage; --strict exits 1 on findings",
  ({ deps, options }) => kbCheck(options["strict"] === true, deps),
  { payload: false, faultCode: 1 },
);
