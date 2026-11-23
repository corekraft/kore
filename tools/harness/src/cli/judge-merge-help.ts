import type { CommandHelp } from "../runtime/index.js";

export const mergeHelp: CommandHelp = {
  purpose:
    "Squash-merges a PR's head commit on GitHub, but only after it re-runs the precheck and every enforced result passes on that same commit. It is the one merge a judge pane may run, and it refuses a head that moved after the verdict. A failing audit gate is logged and never blocks the merge.",
  when: "For the judge, as the last step on a passing PR, after judge approve.",
  whenNot:
    "When the precheck does not pass, send the change back with judge send-back. When the PR is behind main the command refuses it and names the next step. Do not run gh pr merge by hand: a role-bound pane is refused it.",
  flags: {
    reviewer:
      "A login, or several separated by commas, whose principles-review verdicts count; it replaces the reviewerLogins of .claude/harness.json, and without it those logins, else the repository owner's, are used.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: "harness judge merge 942",
      shows:
        "PR 942 squash-merged at its verified head; a failing audit gate is listed as logged and does not block",
    },
    {
      command: "harness judge merge 942 --json",
      shows:
        "the same result as one JSON object: pr, merged, head and any audited items",
    },
  ],
  exits: [
    { code: 0, meaning: "squash-merged at the verified head" },
    {
      code: 1,
      meaning:
        "not merged: the precheck did not pass, the PR is behind main, gh refused the merge, the verdict could not be recorded, or the guardrail inventory is unreadable; stderr names the next step",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, a second operand, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "re-runs the precheck and appends its precheck and guard.audit events to the shared ledger, as judge precheck does; then squash-merges the PR on GitHub with the verified head as the match-head-commit, so a head that moved is refused; nothing else changes",
  },
  seeAlso: ["judge precheck", "judge approve", "judge send-back"],
};

export const sendBackHelp: CommandHelp = {
  purpose:
    "Returns a change to its writer: posts the reason as a comment on the PR, where the orchestrator reads its queue, and records a send-back event with its category at the shared ledger. It merges and approves nothing.",
  when: "For the judge, when the precheck fails or the change should not merge, with a reason the writer can act on.",
  whenNot:
    "When the change passes, approve and merge it instead. A pane that is not the judge reports to the judge, which sends the change back.",
  flags: {
    reason:
      "The reason the writer reads, one or more sentences; it is trimmed and must not be empty. Give it with --reason or with --reason-file, not both.",
    "reason-file":
      "A file to read the reason from, by path; giving it together with --reason is refused.",
    category:
      "The category the send-back counts under, one of: declaration, pattern-mismatch, failed-check, conflict, missing-proof, rule-break, scope, wrong-statement, other.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command:
        'harness judge send-back 942 --reason "The body declares no safety pattern." --category declaration',
      shows:
        "PR 942 sent back: the reason is posted on the PR and its send-back is recorded under declaration",
    },
    {
      command:
        "harness judge send-back 942 --reason-file reason.md --category failed-check",
      shows: "the same, with the reason read from reason.md",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the reason is on the PR and the send-back is recorded",
    },
    {
      code: 1,
      meaning:
        "refused: no reason, both reason flags given, a missing or unknown category, gh could not post the comment, or the ledger rejected the event; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: a flag the command does not declare, a second operand, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "posts one comment on the PR with the reason, signed with the pane's sender line, unless the same reason is already on that head; then appends one send-back event to the shared ledger, unless the newest send-back on the PR already has this reason and category; nothing is merged or approved",
  },
  seeAlso: ["judge precheck", "judge merge", "queue escalate"],
};
