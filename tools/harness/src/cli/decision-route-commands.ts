// `decision route`: the way a pane raises a question. It routes the question to the advisor or
// to the owner, and records decision.routed, behind the decision-advisor flag (ADR 0120).
import {
  DecisionError,
  decisionFlagOn,
  routeQuestion,
  type Routed,
  type RoutePorts,
} from "../decision/index.js";
import { FlagError } from "../flag/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;

/** The `harness decision route` form, quoted in the usage error. */
const FORM =
  "harness decision route --idea <number or slug> --category <name> --question <text> --action <text> [--escalate] [--ledger]";

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
  const result: RoutePorts = {
    flagOn: () => decisionFlagOn(deps.fs, root),
    async idea(ref) {
      const record = await new IdeaRepository(deps.fs, deps.clock, root).get(
        ref,
      );
      return record.number;
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
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
  };
  return result;
}

/** What the pane reads: the route, and for the owner, where to ask. */
function announce(routed: Routed): string {
  return routed.route === "advisor"
    ? `Routed to the advisor for idea ${routed.idea} (signal: ${routed.signal}).`
    : `Routed to the owner for idea ${routed.idea} (signal: ${routed.signal}): ask the owner on the idea's issue.`;
}

const route: Command = {
  summary:
    "route a pane's question to the advisor or to the owner and record decision.routed with the route, the category, the idea and the signal (never the question or the action); the owner gets any reserved, matched, unreadable or escalated question, and the advisor only a question whose category and matcher both agree; refused with nothing recorded while the decision-advisor flag is off in the local overlay (--idea <number or slug> --category <name> --question <text> --action <text> [--escalate] [--json] [--ledger])",
  options: {
    idea: "string",
    category: "string",
    question: "string",
    action: "string",
    escalate: "boolean",
    ledger: "string",
  },
  async run(context) {
    const { options, deps, json } = context;
    if (text(options, "idea") === "") {
      return fail(context, `Missing --idea; run \`${FORM}\`.`, USAGE);
    }
    try {
      // The ledger opens first, so a missing ledger fails before anything is routed.
      const opened = await openLedger(context);
      if ("error" in opened) {
        return fail(context, opened.error, FAILED);
      }
      const routed = await routeQuestion(
        ports(context, await deps.root(), opened.ledger),
        {
          idea: text(options, "idea"),
          category: text(options, "category"),
          question: text(options, "question"),
          action: text(options, "action"),
          escalate: options["escalate"] === true,
        },
      );
      deps.stdout(
        json ? `${JSON.stringify(routed)}\n` : `${announce(routed)}\n`,
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

/** The route command, merged into the `decision` group. */
export const routeCommands: Record<string, Command> = { route };
