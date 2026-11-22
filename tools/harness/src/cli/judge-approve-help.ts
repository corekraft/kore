import type { CommandHelp } from "../runtime/index.js";

export const approveHelp: CommandHelp = {
  purpose:
    "Approves a PR's verified head as the judge pane's own GitHub identity, and only when the precheck passes on that head. It re-runs the precheck first, refuses a head that moved since the verdict and a PR this identity wrote, and posts nothing twice.",
  when: "For the judge, once judge precheck passes on the PR's head and before judge merge.",
  whenNot:
    "When the precheck does not pass: fix what it lists, or return the change with judge send-back. Only the judge pane runs it; the judge's role list names it.",
  flags: {
    reviewer:
      "A login, or several separated by commas, whose principles-review verdicts count; it replaces the reviewerLogins of .claude/harness.json, and without it those logins, else the repository owner's, are used.",
  },
  operand: "The pull request number, a positive whole number.",
  examples: [
    {
      command: "harness judge approve 942",
      shows:
        "PR 942 approved at its verified head, or already approved when this identity approved that commit",
    },
    {
      command: "harness judge approve 942 --json",
      shows:
        "the same result as one JSON object: pr, approved, head and already",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "approved at the verified head, or already approved by this identity on it",
    },
    {
      code: 1,
      meaning:
        "not approved: the precheck did not pass, the head moved, the PR is this identity's own, or gh could not report the login or post the review; stderr names the fix",
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
      "re-runs the precheck and appends its precheck event to the shared ledger, as judge precheck does; then posts one approving review on the PR, signed with the pane's sender line, only when this identity has not approved the verified head; nothing else changes",
  },
  seeAlso: ["judge precheck", "judge merge", "judge send-back"],
};
