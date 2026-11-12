// Deny rules in audit mode: the settings deny list holds only enforced rules
// (Claude Code deny rules cannot warn), so an audit deny rule warns here, with
// a ledger event, and never denies the call (ADR 0080).
import { denyMatches } from "../guardrail/index.js";
import { warn, type Finding, type GuardContext } from "./guard-verdict.js";

/** One warning per audit deny rule with a pattern covering the call. */
export function checkDenyAudit(
  tool: string,
  subject: string,
  ctx: GuardContext,
): Finding[] {
  return ctx.denyRules
    .filter((r) => r.mode === "audit")
    .flatMap((r) => {
      const pattern = r.patterns.find((p) => denyMatches(p, tool, subject));
      return pattern === undefined
        ? []
        : [
            warn(
              r.rule,
              `${subject} matches the deny pattern ${pattern}, which is in audit mode, so this call is allowed with a warning. ` +
                "Instead, avoid it unless the user asked for it; a person promotes the rule to enforce once the audit shows it is safe.",
            ),
          ];
    });
}
