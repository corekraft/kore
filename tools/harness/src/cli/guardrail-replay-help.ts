// The help record for `guardrail replay`, kept beside the command in its own file so the
// command file stays inside the line budget.
import type { CommandHelp } from "../runtime/index.js";

/** The help record for `guardrail replay`: a read-only judgement of one rule change over recorded calls. */
export const replayHelp: CommandHelp = {
  purpose:
    "Replays one guardrail rule over the recorded Bash, Read, Write and Edit calls in a window: it lists each call the rule refused under the old git ref and its new ref's guard allows. Each ref's guard is built in a disposable worktree that is removed afterwards. It reads session transcripts and the inventory, never the ledger.",
  when: "Before an idea changes what a guard blocks, to see which recorded calls the change would newly allow, as the guard-idea checklist requires (ADR 0119).",
  whenNot:
    "When you want a rule's current mode or its pending requests: use guardrail status. When you want the settings deny list: use guardrail deny.",
  flags: {
    rule: "The guardrail rule to replay, as named in .claude/guardrails.yaml.",
    old: "The git ref whose guard refused the calls: a branch, a tag or a commit.",
    new: "The git ref whose guard is judged against: a branch, a tag or a commit.",
    since:
      "The window's start: a date (YYYY-MM-DD) or a UTC timestamp (YYYY-MM-DDTHH:MM:SSZ), in the form of the last retrospective marker.",
    until:
      "The window's end, in the same two forms; the window is open-ended when it is absent.",
  },
  examples: [
    {
      command:
        "harness guardrail replay --rule bare-glob --old main --new HEAD --since 2026-11-01",
      shows:
        "a JSON report (rule, old, new, since, until, examined, empty, changed): the calls the rule refused under main and allows under HEAD",
    },
    {
      command:
        "harness guardrail replay --rule bare-glob --old main --new main --since 2026-11-01 --until 2026-11-15",
      shows:
        "the same report with empty set to true and no changed calls, because both refs judge alike",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the JSON report is printed; an empty changed list is stated as empty",
    },
    {
      code: 1,
      meaning:
        "a ref's guard could not be built or judged, the inventory is missing or invalid, or a replay worktree could not be removed (stderr names it)",
    },
    {
      code: 2,
      meaning:
        "a required flag is missing or not a date, the rule is not in the inventory, a ref names no commit, or a flag the command does not declare",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the session transcripts, .claude/guardrails.yaml and the git refs; creates one worktree under .claude/worktrees for each ref, builds it and removes it before it returns; writes nothing else and never reads the ledger",
  },
  seeAlso: ["guardrail status", "guardrail request", "guardrail activate"],
};
