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
  // session
  "session spawn",
  "session wait",
  "session notify",
  "session send",
  "session check",
  "session close",
  "session tier",
  "session equalize",
  "session prompt-size",
  // skill
  "skill audit",
  // idea
  "idea new",
  "idea list",
  "idea show",
  "idea sync",
  // outcome
  "outcome record",
  "outcome close",
  // decision
  "decision make",
  "decision route",
  "decision ask",
  "decision digest",
  // flag
  // ruleset
  // status
  "status",
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
  // ledger
  "ledger record",
  "ledger list",
  "ledger poll-herdr",
  "ledger poll-github",
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
