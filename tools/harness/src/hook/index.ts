import type { Command } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { linkProblems } from "./skill-links.js";

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

/** The hooks the host runs as `harness hook <name>`; each is a command in this domain. */
export const hook: Record<string, Command> = { "skill-links": skillLinks };
