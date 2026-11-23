// `decision make`: the advisor's tool. It posts one decision on the idea's issue under the
// sender line and records decision.made, behind the decision-advisor flag (ADR 0120).
import {
  DecisionError,
  decisionFlagOn,
  makeDecision,
  type DecisionPorts,
} from "../decision/index.js";
import { FlagError } from "../flag/index.js";
import {
  IdeaError,
  IdeaRepository,
  issueTarget,
  numberedIssue,
} from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { ownerCommands } from "./decision-owner-commands.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;

/** The `harness decision make` form, quoted in the usage error. */
const FORM =
  "harness decision make (--idea <number or slug> | --issue <number>) --category <name> --question <text> --decision <text>";

function text(options: CommandContext["options"], key: string): string {
  const value = options[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Prints an expected failure as the command's message, plus a JSON object first under --json. */
function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

function ports(context: CommandContext, root: string, ledger: Ledger) {
  const { deps } = context;
  const result: DecisionPorts = {
    env: deps.env,
    flagOn: () => decisionFlagOn(deps.fs, root),
    async issue(number) {
      return numberedIssue(deps.runner, root, number);
    },
    async target(ref) {
      const record = await new IdeaRepository(deps.fs, deps.clock, root).get(
        ref,
      );
      const at = await issueTarget(deps.runner, root, record);
      return { idea: record.number, ...at };
    },
    async post({ number, repo }, body) {
      const done = await deps.runner.run(
        "gh",
        ["issue", "comment", number, "--repo", repo, "--body", body],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new DecisionError(
          `gh issue comment failed for issue #${number}: ${done.stderr.trim()}. Check \`gh auth status\`, then rerun the same command.`,
        );
      }
      return done.stdout.trim();
    },
    async record({ idea, label, number }) {
      const written = await ledger.record({
        source: "claude",
        kind: "decision.made",
        occurredAt: deps.clock.now().toISOString(),
        ...(idea === undefined ? {} : { idea }),
        label,
        number,
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
  };
  return result;
}

const makeHelp: CommandHelp = {
  purpose:
    "Records one advisor decision: posts it as a comment on an idea's issue, or a plain ticket's issue, under the sender line, then appends decision.made with the category. The question and the decision are posted in the comment and never stored in the ledger. Refused with nothing posted or recorded while the decision-advisor flag is off in the local overlay.",
  when: "When the advisor has decided a question a pane raised, and the question is one the advisor may decide, so the decision belongs on its issue.",
  whenNot:
    "When the question is the owner's: the reserved list of ADR 0120 refuses it, so use decision ask to put it to the owner. Nothing is posted in those cases.",
  flags: {
    idea: "The idea whose issue the decision is posted on, by its number or slug. Give this or --issue, not both.",
    issue:
      "A plain ticket's issue number, for a ticket with no idea record. Give this or --idea, not both.",
    category:
      "The category the question belongs to: lowercase letters, digits and -, starting with a letter, at most 64 characters, such as naming. A reserved category is refused.",
    question: "What was asked, as text. It must not be empty.",
    decision: "What was decided, as text. It must not be empty.",
    ledger:
      "The ledger file to append to, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command:
        'harness decision make --idea 0042 --category naming --question "Is the flow command named report?" --decision "Keep the name report."',
      shows:
        "the decision posted on idea 0042's issue, and the line Recorded a naming decision for idea 0042, with the comment's URL",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the decision is posted and recorded; its comment's URL is printed, or the result as one object under --json",
    },
    {
      code: 1,
      meaning:
        "refused with nothing posted: the flag is off, both --idea and --issue are given, a field is empty or malformed, the question or category is reserved, the idea is unknown, the sender line cannot be written, or the text carries a guardrail approval line. Also when the comment was posted but its ledger event was rejected; the message says not to post it again",
    },
    { code: 2, meaning: "neither --idea nor --issue is given" },
  ],
  effects: {
    kind: "mutates",
    detail:
      "posts one comment on the idea's or the issue's GitHub issue, under the sender line, then appends one decision.made event carrying the idea or issue number and the category. The ledger is append-only and written only here.",
  },
  seeAlso: ["decision ask", "decision digest"],
};

const make: Command = {
  summary: "post an advisor's decision on an issue and record it",
  options: {
    idea: "string",
    issue: "string",
    category: "string",
    question: "string",
    decision: "string",
    ledger: "string",
  },
  help: makeHelp,
  async run(context) {
    const { options, deps, json } = context;
    const idea = text(options, "idea");
    const issue = text(options, "issue");
    if (idea === "" && issue === "") {
      return fail(
        context,
        `Missing --idea or --issue; run \`${FORM}\`.`,
        USAGE,
      );
    }
    try {
      // The ledger opens first, so a missing ledger fails before anything is posted.
      const opened = await openLedger(context);
      if ("error" in opened) {
        return fail(context, opened.error, FAILED);
      }
      const made = await makeDecision(
        ports(context, await deps.root(), opened.ledger),
        {
          ...(idea === "" ? {} : { idea }),
          ...(issue === "" ? {} : { issue }),
          category: text(options, "category"),
          question: text(options, "question"),
          decision: text(options, "decision"),
        },
      );
      deps.stdout(
        json
          ? `${JSON.stringify(made)}\n`
          : `Recorded a ${made.category} decision for ${made.idea === undefined ? `the issue at ${made.issue}` : `idea ${made.idea}`}: ${made.commentUrl}\n`,
      );
      return 0;
    } catch (error) {
      if (
        error instanceof DecisionError ||
        error instanceof IdeaError ||
        error instanceof FlagError
      ) {
        return fail(context, error.message, FAILED);
      }
      throw error;
    }
  },
};

/** The decision tool: the advisor's way to record a decision on an idea's issue. */
export const decisionCommands: Record<string, Command> = {
  make,
  ...ownerCommands,
};
