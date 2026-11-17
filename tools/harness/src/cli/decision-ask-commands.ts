// `decision ask`: a pane's reserved question. It posts the question on the idea's issue under the
// sender line with the needs-info label, and records decision.routed to the owner, behind the
// decision-advisor flag (ADR 0120). A consent prompt is refused here and never routed.
import {
  askOwner,
  DecisionError,
  decisionFlagOn,
  type AskPorts,
} from "../decision/index.js";
import { FlagError } from "../flag/index.js";
import { IdeaError, IdeaRepository, issueTarget } from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;

/** The `harness decision ask` form, quoted in the usage error. */
const FORM =
  "harness decision ask --idea <number or slug> --category <name> --question <text> --action <text> [--ledger]";

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
  const result: AskPorts = {
    env: deps.env,
    flagOn: () => decisionFlagOn(deps.fs, root),
    async target(ref) {
      const record = await new IdeaRepository(deps.fs, deps.clock, root).get(
        ref,
      );
      const at = await issueTarget(deps.runner, root, record);
      return { idea: record.number, ...at };
    },
    async label({ number, repo }, label) {
      const done = await deps.runner.run(
        "gh",
        ["issue", "edit", number, "--repo", repo, "--add-label", label],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new DecisionError(
          `gh issue edit failed for issue #${number}: ${done.stderr.trim()}. Check \`gh auth status\`, then rerun the same command.`,
        );
      }
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
    async record(event) {
      const written = await ledger.record({
        source: "claude",
        kind: "decision.routed",
        occurredAt: deps.clock.now().toISOString(),
        idea: event.idea,
        label: event.label,
        route: event.route,
        signal: event.signal,
        number: event.number,
        ...(event.pane === undefined ? {} : { pane: event.pane }),
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
  };
  return result;
}

const ask: Command = {
  summary:
    "post a reserved question on the idea's issue under the sender line with the needs-info label, and record decision.routed to the owner with the idea, the category, the route, the signal, the issue number and the posting pane, so a pane waiting on the answer is not reported stalled (never the question or the action); refused with nothing posted while the decision-advisor flag is off in the local overlay, for a consent prompt (a destructive action, which stays inline with its gate), and for a question the advisor decides (--idea <number or slug> --category <name> --question <text> --action <text> [--json: idea, category, issue, commentUrl, signal] [--ledger])",
  options: {
    idea: "string",
    category: "string",
    question: "string",
    action: "string",
    ledger: "string",
  },
  async run(context) {
    const { options, deps, json } = context;
    if (text(options, "idea") === "") {
      return fail(context, `Missing --idea; run \`${FORM}\`.`, USAGE);
    }
    try {
      // The ledger opens first, so a missing ledger fails before anything is posted.
      const opened = await openLedger(context);
      if ("error" in opened) {
        return fail(context, opened.error, FAILED);
      }
      const asked = await askOwner(
        ports(context, await deps.root(), opened.ledger),
        {
          idea: text(options, "idea"),
          category: text(options, "category"),
          question: text(options, "question"),
          action: text(options, "action"),
        },
      );
      deps.stdout(
        json
          ? `${JSON.stringify(asked)}\n`
          : `Asked the owner about idea ${asked.idea}: ${asked.commentUrl}\n`,
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

/** The ask command, merged into the `decision` group. */
export const askCommands: Record<string, Command> = { ask };
