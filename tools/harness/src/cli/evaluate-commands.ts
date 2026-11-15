import { evaluateIdea, type Evaluated } from "../evaluate/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { logOutcome } from "./outcome-commands.js";

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

function recordedText(done: Extract<Evaluated, { status: "recorded" }>) {
  const { concluded } = done;
  const lines = [
    `Idea ${done.idea} ${done.result} (${figure(done.before)} to ${figure(done.after)}); issue closed: ${concluded.issue}`,
  ];
  if (done.result === "inconclusive") {
    lines.push(
      "Flagged: the change stays in place with outcome:inconclusive; no revert is issued.",
    );
  } else if (done.result === "refuted") {
    lines.push("The change stays in place: evaluate never reverts.");
  }
  if (concluded.followUp !== undefined) {
    lines.push(`Follow-up idea: ${concluded.followUp}`);
  }
  return `${lines.join("\n")}\n`;
}

async function evaluation(context: CommandContext, input: Parsed) {
  const { deps, json } = context;
  if ("error" in input) {
    return fail(context, input.error, USAGE_ERROR);
  }
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
  if (done.status === "recorded") {
    await logOutcome(opened.ledger, deps, done.concluded);
  }
  const text =
    done.status === "recorded"
      ? recordedText(done)
      : `Idea ${done.idea} already has outcome ${done.result}; left as recorded.\n`;
  deps.stdout(json ? `${JSON.stringify(done)}\n` : text);
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
    "after a harness idea's measurement window, compare its hypothesis metric (a flow report metric, read from the ledger, never set by an agent) over the window after its merged change with the equal window before, and record confirmed, refuted or inconclusive through the outcome tool: moved the expected direction by at least the threshold is confirmed, the opposite refuted, anything within noise or without history inconclusive; an inconclusive change stays in place and is flagged by its label and follow-up idea; a refuted one is recorded and nothing is reverted; refused inside the window with the time it can run; an idea with an outcome is left as recorded (--idea <number or slug> [--threshold <fraction>, default 0.1] [--changed-by-pr <number>, when the ledger ties no merged PR to the idea's issue] [--ledger]; --json prints status recorded|too-early|already-recorded with idea, result, before, after and the outcome)",
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
