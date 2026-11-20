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
import type { Command, CommandContext } from "../runtime/index.js";
import { ownerCommands } from "./decision-owner-commands.js";
import { routeCommands } from "./decision-route-commands.js";
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

const make: Command = {
  summary:
    "post an advisor's decision on the issue under the sender line and record decision.made with the idea (or, for a plain ticket, the issue number) and the category (never the question or the reasoning); give exactly one of --idea (an idea's number or slug) and --issue (a plain ticket's issue number); refused with nothing posted while the decision-advisor flag is off in the local overlay, when the question matches the reserved list of ADR 0120, or when the category is a reserved one (--idea <number or slug> | --issue <number> --category <name> --question <text> --decision <text> [--json: idea, category, issue, commentUrl])",
  options: {
    idea: "string",
    issue: "string",
    category: "string",
    question: "string",
    decision: "string",
    ledger: "string",
  },
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
  ...routeCommands,
  ...ownerCommands,
};
