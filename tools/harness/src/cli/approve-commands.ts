import {
  APPROVE_FLAG,
  ApproveError,
  Approver,
  approveFlagOn,
  trailingOf,
  type Approval,
} from "../approve/index.js";
import {
  DEFAULT_COST,
  MIN_COMPLETED_IDEAS,
  buildReport,
  flowMetricNames,
} from "../flow/index.js";
import { IdeaError, IdeaRepository, type IdeaRecord } from "../idea/index.js";
import { JudgeError } from "../judge/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { openIssueIo } from "./approve-gh.js";
import { loadCost } from "./flow-commands.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const USAGE = 2;

/** The issue number an idea's `issue` field names: a bare number, `#n` or an issue URL. */
export function issueNumber(record: IdeaRecord): number | undefined {
  const found = /(\d+)\/?$/.exec(record.issue ?? "")?.[1];
  return found === undefined ? undefined : Number(found);
}

function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

const SAYS: Record<Approval["status"], (a: Approval) => string> = {
  approved: (a) =>
    `Approved idea ${a.idea}: ready-for-agent applied to issue #${a.issue}. ${a.reason}\n`,
  "already-approved": (a) =>
    `Idea ${a.idea} is already approved on issue #${a.issue}; nothing changed.\n`,
  "left-for-person": (a) =>
    `Left idea ${a.idea} for a person: ${a.reason} (reason posted on issue #${a.issue})\n`,
  "flag-off": (a) =>
    `The ${APPROVE_FLAG} flag is off, so nothing was written for idea ${a.idea}. Verdict: ${a.reason}\n`,
};

async function approverFor(context: CommandContext): Promise<Approver> {
  const { deps } = context;
  const root = await deps.root();
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new ApproveError(opened.error);
  }
  const loaded = await loadCost(context);
  if ("error" in loaded) {
    throw new ApproveError(loaded.error);
  }
  const ideas = new IdeaRepository(deps.fs, deps.clock, root);
  return new Approver({
    ...(await openIssueIo(context)),
    flagOn: () => approveFlagOn(deps.fs, root),
    idea: (ref) => ideas.get(ref),
    ideas: () => ideas.list(),
    issueOf: issueNumber,
    metrics: async () => {
      const { events } = await opened.ledger.list({});
      const report = buildReport(events, {
        asOf: deps.clock.now(),
        minCompletedIdeas: MIN_COMPLETED_IDEAS,
        cost: { ...DEFAULT_COST, ...loaded.cost },
      });
      return { known: flowMetricNames(), trailing: trailingOf(report) };
    },
    ledger: opened.ledger,
    clock: deps.clock,
  });
}

const approveHelp: CommandHelp = {
  purpose:
    "Applies ready-for-agent to a harness idea whose change is reversible and whose hypothesis metric has enough history in the flow report, and otherwise leaves the idea for a person and says why. It is off until the automatic-approval flag is on in the local overlay: with the flag off it writes nothing.",
  when: "When an idea is ready to be taken by an agent and its verdict is wanted. Nothing runs it unprompted.",
  whenNot:
    "When you want a person's approval: an agent's label is never a person's approval. When the idea has no issue, run idea sync first.",
  flags: {
    idea: "The idea's number or slug, as idea show reads it; required.",
    ledger:
      "The ledger file the approval reads and writes, relative to the working directory; without it, the shared ledger of the main checkout.",
  },
  examples: [
    {
      command: "harness approve --idea 42",
      shows:
        "idea 42's verdict: approved, already-approved, left-for-person, or flag-off with the reason it would give",
    },
    {
      command: "harness approve --idea 42 --json",
      shows:
        "the same verdict as one JSON object: idea, issue, status, reason and warnings",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "a verdict was reached, whatever its status; left-for-person and flag-off are exit 0 too",
    },
    {
      code: 1,
      meaning:
        "refused: the idea has no issue, the ledger or cost settings or the idea cannot be read, or an event was rejected; stderr names the fix",
    },
    {
      code: 2,
      meaning:
        "a usage error: no --idea, a flag the command does not declare, or a flag with no value",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "with the automatic-approval flag off in the local overlay it writes nothing and only reports the verdict; with it on it comments the verdict on the idea's issue, adds ready-for-agent when approved, and appends qualifier.warned and auto-approved events to the ledger, each once, so a rerun changes nothing",
  },
  seeAlso: ["idea show", "idea sync", "flow report"],
};

export const approveCommand: Command = {
  summary: `apply ready-for-agent to a harness idea only when its change is reversible (no-behaviour-change, feature-flagged, dark-launched or branch-by-abstraction, and not moving a guardrail to enforce) and its hypothesis metric is in the flow report with enough history for a trailing average; otherwise leave it for a person and say why; the reason is posted as a comment on the idea's issue and an auto-approved event is recorded in the ledger, each once, so a rerun changes nothing; it warns, and never refuses, when the idea's primary metric is a guard metric or another open idea's primary (ADR 0119), and records a qualifier.warned event per warning; nothing runs it unprompted, and with the ${APPROVE_FLAG} flag off in the local overlay it writes nothing and only reports the verdict; an agent's label is never a person's approval (--idea <number or slug> [--json: idea, issue, status approved|already-approved|left-for-person|flag-off, reason, warnings] [--ledger])`,
  help: approveHelp,
  options: { idea: "string", ledger: "string" },
  async run(context) {
    const ref = context.options["idea"];
    if (typeof ref !== "string" || ref.trim() === "") {
      return fail(
        context,
        "Missing --idea; run `harness approve --idea <number or slug>`.",
        USAGE,
      );
    }
    try {
      const approval = await (await approverFor(context)).run(ref.trim());
      context.deps.stdout(
        context.json
          ? `${JSON.stringify(approval)}\n`
          : SAYS[approval.status](approval) +
              approval.warnings.map((w) => `Warning: ${w}\n`).join(""),
      );
      return 0;
    } catch (error) {
      if (!(
        error instanceof ApproveError ||
        error instanceof IdeaError ||
        error instanceof JudgeError
      )) {
        throw error;
      }
      return fail(context, error.message, FAILED);
    }
  },
};
