import { evaluateIdea, type Evaluated } from "../evaluate/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { senderFrom, type Sender } from "../sender/index.js";
import { openLedger } from "./ledger-commands.js";
import { logOutcome } from "./outcome-commands.js";
import { prepareRevertFor } from "./revert-commands.js";
import type { RevertResult } from "../revert/index.js";

const USAGE_ERROR = 2;
const FAILED = 1;
const DEFAULT_THRESHOLD = 0.1;

type Parsed =
  { ref: string; threshold: number; changedByPr?: number } | { error: string };

function parse({ options }: CommandContext): Parsed {
  const ref = options["idea"];
  if (typeof ref !== "string" || ref.trim() === "") {
    return {
      error: "Missing --idea; run `harness evaluate --idea <number or slug>`.",
    };
  }
  const given = options["threshold"];
  const threshold = given === undefined ? DEFAULT_THRESHOLD : Number(given);
  if (!(threshold > 0) || typeof given === "boolean") {
    return {
      error: `Invalid --threshold "${String(given)}". Use a fraction above 0 such as 0.1 for 10%.`,
    };
  }
  const pr = options["changed-by-pr"];
  if (pr !== undefined && !/^[1-9]\d*$/.test(String(pr))) {
    return {
      error: `Invalid --changed-by-pr "${String(pr)}". Use a PR number such as 123.`,
    };
  }
  return {
    ref: ref.trim(),
    threshold,
    ...(pr === undefined ? {} : { changedByPr: Number(pr) }),
  };
}

const figure = (value: number | null) => value ?? "none";

const LANDS = "(not merged; the judge approves and merges it)";

const FIXED: Partial<Record<RevertResult["status"], string>> = {
  "already-reverted": "Already reverted: the ledger holds this idea's revert.",
  "flag-off":
    "No revert prepared: the automatic-revert flag is off in the local overlay.",
  guardrail:
    "Not reverted automatically: the change edited the guardrail inventory, and a guardrail never goes straight back to enforce. Run `harness guardrail request --to audit` for it.",
};

function revertLine(revert: RevertResult): string | undefined {
  if (revert.status === "prepared") {
    return `Revert prepared: ${revert.url} ${LANDS}.`;
  }
  if (revert.status === "already-prepared") {
    return `Revert already open: ${revert.url} ${LANDS}.`;
  }
  return FIXED[revert.status];
}

function recordedText(
  done: Extract<Evaluated, { status: "recorded" }>,
  revert: RevertResult,
) {
  const { concluded } = done;
  const sentBack =
    done.guard === undefined
      ? ""
      : `; ${done.guard.metric} ${figure(done.guard.before)} to ${figure(done.guard.after)}`;
  const lines = [
    `Idea ${done.idea} ${done.result} (${figure(done.before)} to ${figure(done.after)})${sentBack}; issue closed: ${concluded.issue}`,
  ];
  if (done.result === "inconclusive") {
    lines.push(
      "Flagged: the change stays in place with outcome:inconclusive; no revert is issued.",
    );
  }
  const line = revertLine(revert);
  if (line !== undefined) {
    lines.push(line);
  }
  if (concluded.followUp !== undefined) {
    lines.push(`Follow-up idea: ${concluded.followUp}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The sender of the outcome comment this run posts; refused when the environment cannot name it. */
function senderOf({ deps }: CommandContext): Sender {
  const sender = senderFrom(deps.env, "evaluate");
  if ("error" in sender) {
    throw new IdeaError(sender.error);
  }
  return sender;
}

async function evaluation(context: CommandContext, input: Parsed) {
  const { deps, json } = context;
  if ("error" in input) {
    return fail(context, input.error, USAGE_ERROR);
  }
  const sender = senderOf(context);
  const opened = await openLedger(context);
  if ("error" in opened) {
    return fail(context, opened.error, FAILED);
  }
  const root = await deps.root();
  const ctx = {
    repo: new IdeaRepository(deps.fs, deps.clock, root),
    runner: deps.runner,
    clock: deps.clock,
    root,
    sender,
  };
  const { events } = await opened.ledger.list({});
  const done = await evaluateIdea(ctx, events, {
    ref: input.ref,
    now: deps.clock.now(),
    threshold: input.threshold,
    ...(input.changedByPr === undefined
      ? {}
      : { changedByPr: input.changedByPr }),
  });
  if (done.status === "too-early") {
    const message = `Idea ${done.idea} is inside its measurement window; run \`harness evaluate --idea ${input.ref}\` from ${done.evaluableAt}.`;
    deps.stderr(json ? `${JSON.stringify(done)}\n` : `${message}\n`);
    return FAILED;
  }
  if (done.status !== "recorded") {
    const text = `Idea ${done.idea} already has outcome ${done.result}; left as recorded.\n`;
    deps.stdout(json ? `${JSON.stringify(done)}\n` : text);
    return 0;
  }
  await logOutcome(opened.ledger, deps, done.concluded);
  const revert = await prepareRevertFor(context, opened.ledger, done);
  deps.stdout(
    json
      ? `${JSON.stringify({ ...done, revert })}\n`
      : recordedText(done, revert),
  );
  return 0;
}

function fail(
  { json, deps }: CommandContext,
  message: string,
  code: number,
): number {
  deps.stderr(
    json ? `${JSON.stringify({ error: message })}\n` : `${message}\n`,
  );
  return code;
}

export const evaluateCommand: Command = {
  summary:
    "after a harness idea's measurement window, compare its hypothesis metric (a flow report metric, read from the ledger, never set by an agent) over the window after its merged change with the equal window before, and record confirmed, refuted or inconclusive through the outcome tool: moved the expected direction by at least the threshold is confirmed, the opposite refuted, anything within noise or without history inconclusive; an inconclusive change stays in place and is flagged by its label and follow-up idea; a refuted one is recorded and, when the automatic-revert flag is on in the local overlay, its merged PR is reverted on a branch off main and the revert PR is opened declaring no-behaviour-change but never merged (the judge merges it), once per idea, with a harness-change-reverted ledger event, and a change that edited the guardrail inventory is left to `guardrail request`; a model-tier idea (tier-change and guard-metric in its frontmatter) is judged on both metrics: tokens per idea falling is confirmed only while judge send-backs (rework.sendBacksPerIdea) do not rise past the threshold, and refuted, so reverted, when they do; refused inside the window with the time it can run; an idea with an outcome is left as recorded (--idea <number or slug> [--threshold <fraction>, default 0.1] [--changed-by-pr <number>, when the ledger ties no merged PR to the idea's issue] [--ledger]; --json prints status recorded|too-early|already-recorded with idea, result, before, after, guard (metric, before, after) for a tier idea, the outcome and, once recorded, revert: status not-refuted|flag-off|already-reverted|already-prepared|guardrail|prepared with number and url)",
  options: {
    idea: "string",
    threshold: "string",
    "changed-by-pr": "string",
    ledger: "string",
  },
  async run(context) {
    try {
      return await evaluation(context, parse(context));
    } catch (error) {
      if (!(error instanceof IdeaError)) {
        throw error;
      }
      return fail(context, error.message, FAILED);
    }
  },
};
