import { opsReport } from "../ops/index.js";
import type { CommandContext } from "./context.js";
import { stringFlag } from "./flags.js";
import { print } from "./output.js";

/** Read-only operational checks; exits 1 when the report lists problems. */
export async function opsCommand(context: CommandContext): Promise<number> {
  const from = stringFlag(context.parsed, "from");
  const { report, ok } = await opsReport(context.action ?? "", {
    repository: context.repository,
    runner: context.runner,
    json: context.json,
    ...(from === undefined ? {} : { from }),
  });
  print(report, context.json);
  return ok ? 0 : 1;
}
