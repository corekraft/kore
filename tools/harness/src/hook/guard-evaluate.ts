// Decides one tool call: the role bounds first, then the Bash and file rules.
import { evaluateBash } from "./guard-bash.js";
import { evaluateFile } from "./guard-file.js";
import { checkRole } from "./guard-role.js";
import { allow, type GuardContext, type Verdict } from "./guard-verdict.js";
import type { Call } from "./feedback.js";

export interface GuardCall extends Call {
  agent_type?: unknown;
  tool_input?: Record<string, unknown> & { file_path?: unknown };
}

export const asCall = (payload: unknown): GuardCall =>
  typeof payload === "object" && payload !== null ? (payload as GuardCall) : {};

/** Decide on one tool call. */
export async function evaluate(
  payload: unknown,
  ctx: GuardContext,
): Promise<Verdict> {
  const call = asCall(payload);
  const tool = call.tool_name;
  const input = call.tool_input ?? {};

  const bounded =
    typeof tool === "string"
      ? checkRole(call.agent_type, tool, input, ctx.root)
      : null;
  if (bounded !== null) {
    return bounded;
  }

  if (tool === "Bash" && typeof input["command"] === "string") {
    return await evaluateBash(input["command"], ctx);
  }

  const filePath = input.file_path;
  if (
    (tool === "Read" || tool === "Write" || tool === "Edit") &&
    typeof filePath === "string"
  ) {
    const prefix = `${ctx.root}/`;
    const relative = filePath.startsWith(prefix)
      ? filePath.slice(prefix.length)
      : filePath;
    return await evaluateFile(tool, input, relative, ctx);
  }

  return allow;
}
