/** Every ledger event kind. */
export const KINDS = [
  "session.start",
  "session.stop",
  "session.compacted",
  "tool.start",
  "tool.end",
  "pane.spawned",
  "pane.busy",
  "pane.waiting",
  "pane.closed",
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "pr.linked",
  "pr.checked",
  "outcome",
  "flag.activated",
  "token.usage",
  "token.split",
  "session.launch",
  "session.labelled",
  "guard.audit",
  "guard.block",
  // Retired: no code records it, but a ledger written earlier holds it and must still parse.
  "challenge.round",
  "precheck",
  "send-back",
  "review.run",
  "escalation",
  "ci.main",
  "ci.nightly",
  "main.revert",
  "owner.action",
  "owner.replied",
  "host-sample",
  "kore.retry",
  "pane.interrupted",
  "retro-triggered",
  "auto-approved",
  "guardrail.requested",
  "harness-change-reverted",
  "guardrail.activated",
  "guardrail.approval-warned",
  "session.send",
  "idea.filed",
  "decision.made",
  "decision.routed",
  "advisor.overturned",
  "decision.digest",
  "decision.blocking",
  "retro.dropped",
  "retro.main-session",
  "owner.asked",
  "spawn.unstamped",
  "session.result",
  "pane.finished",
  "pane.stalled",
  "qualifier.warned",
  "tick.bound",
  "tick.started",
  "tick.stopped",
  "tick.plan",
  "tick.self-update-failed",
  "ticket.waiting",
] as const;
export type Kind = (typeof KINDS)[number];

export const NUMBER_KINDS: readonly Kind[] = [
  "issue.opened",
  "issue.labelled",
  "issue.closed",
  "pr.opened",
  "pr.merged",
  "pr.linked",
  "pr.checked",
  "outcome",
  "challenge.round",
  "precheck",
  "send-back",
  "review.run",
  "escalation",
  "owner.action",
  "owner.replied",
  "advisor.overturned",
  "decision.made",
  "decision.routed",
  "auto-approved",
  "qualifier.warned",
  "harness-change-reverted",
  "retro.dropped",
  "tick.plan",
];

/** The kinds that link a pull request to its writer: the writer's session and agent are required on them. */
export const LINK_KINDS: readonly Kind[] = ["pr.linked"];

/** The format of session and agent is checked by the generic rules; these only require both on LINK_KINDS. */
export const LINK_RULES: ReadonlyArray<{
  readonly field: string;
  readonly check: (value: unknown) => boolean;
  readonly hint: string;
  readonly requiredOn: readonly Kind[];
}> = [
  {
    field: "session",
    check: () => true,
    hint: "must name the writer's session",
    requiredOn: LINK_KINDS,
  },
  {
    field: "agent",
    check: () => true,
    hint: "must name the writer's agent",
    requiredOn: LINK_KINDS,
  },
];

/** The kinds whose `label` is written: a name, a category, or a reason. */
export const LABEL_KINDS: readonly Kind[] = [
  "tick.self-update-failed",
  "issue.labelled",
  "session.labelled",
  "outcome",
  "flag.activated",
  "guard.audit",
  "guard.block",
  "challenge.round",
  "precheck",
  "pr.checked",
  "send-back",
  "review.run",
  "escalation",
  "kore.retry",
  "retro-triggered",
  "auto-approved",
  "qualifier.warned",
  "tick.bound",
  "ticket.waiting",
  "session.send",
  "guardrail.requested",
  "guardrail.activated",
  "guardrail.approval-warned",
  "idea.filed",
  "decision.made",
  "decision.routed",
  "retro.dropped",
  "spawn.unstamped",
];

export {
  COMPACTION_RULES,
  SPLIT_RULES,
  type CompactionOrigin,
  type SplitOrigin,
} from "./schema-split.js";

export {
  TERMINAL_RULES,
  TERMINAL_STATUSES,
  type TerminalOrigin,
  type TerminalStatus,
} from "./schema-terminal.js";

export {
  DECISION_ROUTE_RULES,
  DECISION_ROUTES,
  DECISION_ROUTE_SIGNALS,
  type DecisionRoute,
  type DecisionRouteOrigin,
  type DecisionRouteSignal,
} from "./schema-decision-route.js";
