// The `flag audit` command: the flag-wide audit, or with --vps the vps-limited
// audit (ADR 0147). Split out of flag-commands.ts to keep its dependencies
// within the lint cap.

import { proofAudit, unprovenLine, waivedLine } from "../flag/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { auditHelp } from "./flag-audit-help.js";
import { auditVps } from "./flag-audit-vps.js";
import { FAILED, guarded, root } from "./flag-command-helpers.js";

async function auditFlags(context: CommandContext): Promise<number> {
  const { deps, json } = context;
  const base = await root(context);
  const { unproven, waived } = await proofAudit(deps.fs, deps.clock, base);
  if (unproven.length === 0) {
    deps.stdout(
      json
        ? `${JSON.stringify({ unproven, waived })}\n`
        : `Flag audit passed: no flag is on without proof.\n${waived.map((w) => `${waivedLine(w)}\n`).join("")}`,
    );
    return 0;
  }
  const lines = unproven.map(unprovenLine);
  deps.stderr(
    json
      ? `${JSON.stringify({ unproven, waived })}\n`
      : `${lines.join("\n")}\n`,
  );
  return FAILED;
}

export const audit: Command = {
  help: auditHelp,
  summary:
    "fail when a flag is on in any environment overlay without a recorded verification outcome",
  options: { vps: "boolean" },
  run: (context) =>
    guarded(context, async () =>
      context.options["vps"] === true
        ? auditVps(context, await root(context))
        : auditFlags(context),
    ),
};
