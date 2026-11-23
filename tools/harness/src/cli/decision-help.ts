// The help records of the decision commands (plan 17, ADR 0120). They sit beside the command
// files, which attach each to its command, so no command file outgrows its size budget.
import type { CommandHelp } from "../runtime/index.js";

export const askHelp: CommandHelp = {
  purpose:
    "Posts a reserved question to the owner: a comment on the idea's issue under the sender line, with the needs-info label, then appends decision.routed to the owner. The pane's own record lets a pane waiting on the answer go unreported as stalled. The question and the action are posted and never stored in the ledger. Refused with nothing posted or recorded while the decision-advisor flag is off in the local overlay.",
  when: "When a pane has a question only the owner can answer, because the router sent it to the owner or it is reserved, and the pane must wait for the answer.",
  whenNot:
    "When the advisor may decide it: use decision make. A consent prompt for a destructive command is never routed: stop and report it, since the refusal says to. Nothing is posted in those cases.",
  flags: {
    idea: "The idea the question is about, by its number or slug. Required.",
    category:
      "The category the pane declares: lowercase letters, digits and -, starting with a letter, such as naming. Required, and it must be a valid name.",
    question: "The question, as text. Give this or --question-file.",
    "question-file":
      "A path to a file holding the question, written with the Write tool; read in place of --question. Giving both is refused.",
    action:
      "What the pane would do if the answer is yes, as text. Give this or --action-file.",
    "action-file":
      "A path to a file holding the action, read in place of --action. Giving both is refused.",
    ledger:
      "The ledger file to append to, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command:
        'harness decision ask --idea 0042 --category scope --question "Include the legacy flow in the report?" --action "Include it and note it in the PR."',
      shows:
        "the question posted on idea 0042's issue with the needs-info label, and the line Asked the owner about idea 0042, with the comment's URL",
    },
    {
      command:
        "harness decision ask --idea 0042 --category scope --question-file question.md --action-file action.md --json",
      shows:
        "the posted question as one object (idea, category, issue, commentUrl and signal), with its text read from the two files",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the question is posted and recorded; its comment's URL is printed, or the result as one object under --json",
    },
    {
      code: 1,
      meaning:
        "refused with nothing recorded: the flag is off, the action is destructive, the advisor decides the question, a field is empty or malformed, a flag and its file are both given or the file is missing, unreadable or empty, the sender line cannot be written, the text carries a guardrail approval line, the idea is unknown, or a GitHub call fails. Also when the question was posted but its route was not recorded; the message says not to ask again",
    },
    { code: 2, meaning: "--idea is not given" },
  ],
  effects: {
    kind: "mutates",
    detail:
      "adds the needs-info label to the idea's GitHub issue, posts one comment under the sender line, then appends one decision.routed event to the owner. The ledger is append-only and written only here.",
  },
  seeAlso: ["decision make"],
};
