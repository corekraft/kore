import { join } from "node:path";
import { CommandError, type Command } from "../runtime/index.js";
import { auditSkills, renderReport } from "./audit.js";

const SKILLS_DIR = "skills";

const audit: Command = {
  summary: "report each skill's description and body against its budgets",
  options: { strict: "boolean" },
  async run({ json, options, deps }) {
    const skillsDir = join(await deps.root(), SKILLS_DIR);
    let report;
    try {
      report = await auditSkills(deps.fs, skillsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new CommandError(
          `No skills directory at ${skillsDir}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`,
        );
      }
      throw error;
    }
    deps.stdout(json ? `${JSON.stringify(report)}\n` : renderReport(report));
    const failing = report.summary["over-budget"] + report.summary.invalid > 0;
    return options["strict"] === true && failing ? 1 : 0;
  },
};

export const skill: Record<string, Command> = { audit };
