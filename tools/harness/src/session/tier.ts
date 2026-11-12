import type { CommandContext } from "../runtime/index.js";
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
