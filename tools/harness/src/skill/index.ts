import { join } from "node:path";
import {
  CommandError,
  type Command,
  type CommandHelp,
  type FileSystem,
} from "../runtime/index.js";
import { auditSkills, renderReport, type AuditReport } from "./audit.js";

const SKILLS_DIR = "skills";

async function skillReport(fs: FileSystem, root: string) {
  const skillsDir = join(root, SKILLS_DIR);
  try {
    return await auditSkills(fs, skillsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CommandError(
        `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`,
      );
    }
    throw error;
  }
}

const isFailing = (report: AuditReport) =>
  report.summary["over-budget"] + report.summary.invalid > 0;

/** The text `skill audit` prints and whether it fails, for a caller that reports it beside its own output. */
export async function skillAudit(
  fs: FileSystem,
  root: string,
): Promise<{ text: string; failing: boolean }> {
  const report = await skillReport(fs, root);
  return { text: renderReport(report), failing: isFailing(report) };
}

const auditHelp: CommandHelp = {
  purpose:
    "Measures each skill under skills/: its description's length and its body's line count, against the budgets of 200 characters and 25 lines, and reports each skill as ok, over budget or invalid. With --json it prints the report as one object.",
  when: "After editing a SKILL.md, to see whether its description or its body is over budget before the change is committed.",
  whenNot:
    "When you need a skill's text: read its SKILL.md. This command measures sizes only and does not judge the text.",
  flags: {
    strict:
      "Exits 1 when any skill is over budget or invalid, so a check can fail on it. Without the flag the report is printed and the command exits 0.",
  },
  examples: [
    {
      command: "harness skill audit",
      shows:
        "a table of each skill's description and body sizes with its verdict, then the counts of ok, over-budget and invalid skills; exit 0",
    },
    {
      command: "harness skill audit --strict",
      shows:
        "the same table, and exit 1 with the budget each over-budget skill exceeds",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the report is printed; with --strict, no skill is over budget or invalid",
    },
    {
      code: 1,
      meaning:
        "with --strict, a skill is over budget or invalid; or there is no skills directory at the root (run from the repository, or set CLAUDE_PROJECT_DIR)",
    },
    { code: 2, meaning: "a usage error, such as an unknown flag" },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads each skills/<name>/SKILL.md and prints the report; writes nothing",
  },
  seeAlso: ["hook kb-check"],
};

const audit: Command = {
  summary: "report each skill's description and body against its budgets",
  options: { strict: "boolean" },
  help: auditHelp,
  async run({ json, options, deps }) {
    const report = await skillReport(deps.fs, await deps.root());
    deps.stdout(json ? `${JSON.stringify(report)}\n` : renderReport(report));
    return options["strict"] === true && isFailing(report) ? 1 : 0;
  },
};

export const skill: Record<string, Command> = { audit };
