// The hooks that check the repository itself and read no host payload.
import type { CommandHelp } from "../runtime/index.js";
import { linkProblems } from "./skill-links.js";
import { workflowProblems } from "./workflow-permissions.js";
import { hookCommand } from "./io.js";
import { kbCheck } from "./kb-check.js";

const skillLinksHelp: CommandHelp = {
  purpose:
    "Reports each skill under skills/ that the .claude or .codex directory does not link by its relative path, one line per problem.",
  when: "mise run test-hooks runs it with --strict. Run it by hand after adding or moving a skill, to see whether a harness directory still reaches it.",
  whenNot:
    "To check a skill's description and body budgets, use harness skill audit.",
  flags: {
    strict:
      "A fault, such as no skills directory, exits 1 instead of failing open with 0.",
  },
  examples: [
    {
      command: "harness hook skill-links --strict",
      shows:
        "each skill that no harness directory links, one per line, with exit 1; nothing and exit 0 when every skill is linked",
    },
  ],
  exits: [
    { code: 0, meaning: "every skill is linked" },
    {
      code: 1,
      meaning:
        "a skill is not linked, and stderr lists each one; or a fault under --strict",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the skills directory and the harness directories' links, and writes nothing. It reads standard input and ignores it, so run it by hand with </dev/null",
  },
  seeAlso: ["skill audit", "hook workflow-permissions", "hook kb-check"],
};

export const skillLinks = hookCommand(
  "skill-links",
  "report skills a harness directory does not link by relative path",
  async ({ deps }) => {
    const problems = await linkProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
  { help: skillLinksHelp },
);

const workflowPermissionsHelp: CommandHelp = {
  purpose:
    "Checks the token permissions of the workflows under .github/workflows. Only the signing jobs of release.yaml may hold id-token or packages write, each signing job runs on its exact ref condition, every job states its permissions, and no pull request trigger may sign. Each problem is one line with its fix.",
  when: "mise run test-hooks runs it with --strict. Run it by hand after editing a workflow's permissions or its if: conditions.",
  whenNot:
    "To lint the workflow YAML or scan it for security issues, run the actionlint and zizmor tasks in .mise.toml; this hook checks only token permissions.",
  flags: {
    strict:
      "A fault, such as no workflows directory, exits 1 instead of failing open with 0.",
  },
  examples: [
    {
      command: "harness hook workflow-permissions --strict",
      shows:
        "each permission problem with its fix, and exit 1 when there is one; nothing and exit 0 when every workflow is correct",
    },
  ],
  exits: [
    { code: 0, meaning: "every workflow's token permissions are correct" },
    {
      code: 1,
      meaning:
        "a problem, and stderr lists each with its fix; or a fault, which exits 0 with a note on stderr unless --strict makes it exit 1",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the workflow files under .github/workflows and writes nothing. It reads standard input and ignores it, so run it by hand with </dev/null",
  },
  seeAlso: ["hook skill-links", "hook kb-check"],
};

export const workflowPermissions = hookCommand(
  "workflow-permissions",
  "report workflows whose token permissions break the signer guard",
  async ({ deps }) => {
    const problems = await workflowProblems(deps.fs, await deps.root());
    return problems.length === 0
      ? {}
      : { code: 1, stderr: `${problems.join("\n")}\n` };
  },
  { help: workflowPermissionsHelp },
);

const kbCheckHelp: CommandHelp = {
  purpose:
    "Checks the knowledge base: document links, the index, frontmatter, Docs: markers and README coverage, the repository's git configuration, and the flag and skill audits. Stale documents and flags without proof print as warnings that never change the exit code.",
  when: "After editing docs, skills or the knowledge base, to read the findings. mise run kb-check and the test-hooks task run it in warn mode.",
  whenNot:
    "To audit one skill's budget, use harness skill audit; to check only the skill links, use harness hook skill-links.",
  flags: {
    strict:
      "Exit 1 when there is any finding, a skill is over budget or invalid, or the skill audit cannot run. A fault exits 1 either way.",
  },
  examples: [
    {
      command: "harness hook kb-check",
      shows:
        "each finding as file:line with its fix, then the warnings; exit 0 in warn mode even with findings",
    },
    {
      command: "harness hook kb-check --strict",
      shows:
        "the same report, with exit 1 when there is a finding or a failing skill audit",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "no finding, or findings and warnings printed in warn mode",
    },
    {
      code: 1,
      meaning:
        "under --strict, a finding, a skill over budget or invalid, or a skill audit that could not run; also any fault",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the files git tracks or does not ignore, and the git history and config; it writes nothing",
  },
  seeAlso: ["skill audit", "flag audit", "hook skill-links"],
};

export const kbCheckHook = hookCommand(
  "kb-check",
  "report knowledge-base problems: links, the index, frontmatter, markers and README coverage; --strict exits 1 on findings",
  ({ deps, options }) => kbCheck(options["strict"] === true, deps),
  { payload: false, faultCode: 1, help: kbCheckHelp },
);
