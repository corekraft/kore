import { join } from "node:path";
import {
  CommandError,
  type Command,
  type FileSystem,
} from "../runtime/index.js";
import { auditSkills, renderReport } from "./audit.js";

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

/** The text `skill audit` prints, for a caller that reports it beside its own output. */
export async function skillAuditText(
  fs: FileSystem,
  root: string,
): Promise<string> {
  return renderReport(await skillReport(fs, root));
}

const audit: Command = {
  summary: "report each skill's description and body against its budgets",
  options: { strict: "boolean" },
  async run({ json, options, deps }) {
    const report = await skillReport(deps.fs, await deps.root());
    deps.stdout(json ? `${JSON.stringify(report)}\n` : renderReport(report));
    const failing = report.summary["over-budget"] + report.summary.invalid > 0;
    return options["strict"] === true && failing ? 1 : 0;
  },
};

export const skill: Record<string, Command> = { audit };
