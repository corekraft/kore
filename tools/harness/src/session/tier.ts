import type { CommandContext, CommandHelp } from "../runtime/index.js";
import { resolveTier } from "./agent-definition.js";
import { USAGE_ERROR, fail } from "./output.js";

/** `session tier <role>`: the model and effort a spawn launches the role at, read from its definition. Read-only. */
export async function tier({
  json,
  deps,
  operand,
}: CommandContext): Promise<number> {
  if (operand === undefined || operand === "") {
    return fail(
      deps,
      json,
      USAGE_ERROR,
      "Missing the role: run `session tier <role>`.",
    );
  }
  const found = await resolveTier(deps, operand, {});
  if ("error" in found) {
    return fail(deps, json, USAGE_ERROR, found.error);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ role: operand, ...found })}\n`
      : `${operand}: ${found.model}, effort ${found.effort}\n`,
  );
  return 0;
}

export const tierHelp: CommandHelp = {
  purpose:
    "Prints the model and effort a role launches at, read from its agent definition in .claude/agents, the one place a role's tier is declared.",
  when: "Before a spawn, to see which model and effort a role runs at, or to confirm that an edit to its definition is what a spawn will use.",
  whenNot:
    "To run a session at a different tier, pass --model or --effort to session spawn. This command reads the definition only and overrides nothing.",
  flags: {},
  operand:
    "The role whose agent definition is read, such as writer. A role whose definition does not declare a model or effort is refused.",
  examples: [
    {
      command: "harness session tier writer",
      shows:
        "the writer's model and effort from its definition, printed on one line; exit 0",
    },
    {
      command: "harness session tier",
      shows:
        "the role is missing, so the command exits 2 and says how to run it",
    },
  ],
  exits: [
    { code: 0, meaning: "the model and effort are printed" },
    {
      code: 2,
      meaning:
        "a usage error: no role is given, or the role's definition does not declare a model or effort (a role with no definition declares none)",
    },
  ],
  effects: {
    kind: "read-only",
    detail: "reads .claude/agents/<role>.md and prints; changes nothing",
  },
  seeAlso: ["session spawn"],
};
