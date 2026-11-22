/**
 * Commands not yet documented, one per line and grouped by domain, so parallel domain pull
 * requests rebase cleanly: a domain documents its commands and removes their lines here.
 * A command not on this list must carry help (the registry specs fail it otherwise).
 * A domain's only command is named by the domain alone.
 */
export const undocumented: readonly string[] = [
  // plan
  "plan active",
  "plan tick",
  "plan next",
  "plan clear-next",
  // adr
  "adr new",
  "adr supersede",
  // guardrail
  "guardrail status",
  "guardrail deny",
  "guardrail request",
  "guardrail activate",
  "guardrail replay",
  // hook
  "hook context",
  "hook delta",
  "hook feedback",
  "hook guard",
  "hook kb-check",
  "hook record",
  "hook retro-scan",
  "hook skill-links",
  "hook statusline",
  "hook test-budget",
  "hook unit-specs",
  "hook workflow-permissions",
  // idea
  "idea new",
  "idea list",
  "idea show",
  "idea sync",
  // outcome
  "outcome record",
  "outcome close",
  // flag
  "flag activate",
  "flag audit",
  // ruleset
  "ruleset sync",
  "ruleset insights",
  // judge
  "judge precheck",
  "judge declaration",
  "judge diff",
  "judge approve",
  "judge merge",
  "judge send-back",
  // review
  "review post",
  "review run",
  "review resample",
  // pr
  "pr checks",
  "pr check",
  "pr open",
  // flow
  "flow report",
  // queue
  "queue next",
  "queue send-backs",
  "queue escalate",
  // retro
  "retro due",
  "retro record",
  // evaluate
  "evaluate",
  // orchestrate
  "orchestrate run",
  "orchestrate tick",
  "orchestrate plan",
  // approve
  "approve",
];
