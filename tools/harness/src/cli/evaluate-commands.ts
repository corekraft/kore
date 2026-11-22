import { evaluateIdea, type Evaluated } from "../evaluate/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
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

const evaluateHelp: CommandHelp = {
  purpose:
    "Judges a harness idea once its measurement window has passed: compares its hypothesis metric over the window after its merged change with the equal window before it, and records the result through the same path as outcome record. Confirmed needs a move in the expected direction of at least the threshold, refuted the opposite move by at least the threshold, and anything within noise or without history is inconclusive. A model-tier idea is also held against judge send-backs: its tokens per idea falling is confirmed only while send-backs do not rise past the threshold, and refuted when they do.",
  when: "When a harness idea's window has passed since its change merged, and the idea has no outcome yet.",
  whenNot:
    "Inside the window it refuses and prints when it can run. For an idea that is not a harness idea, or whose change is not merged, nothing is judged: use outcome record with a result you measured.",
  flags: {
    idea: "The harness idea's number or slug, as harness idea list shows it.",
    threshold:
      "The relative move counted as signal, a fraction above 0: 0.1 is 10%. A move inside it is inconclusive. Default 0.1.",
    "changed-by-pr":
      "The PR number that delivered the change, a positive whole number; use it when the ledger does not tie a merged PR to the idea's issue.",
    ledger:
      "A ledger file to read and append to, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command: "harness evaluate --idea 412",
      shows:
        "the verdict with its before and after figures and the issue it closed, or the time the window ends when it has not passed",
    },
    {
      command:
        "harness evaluate --idea 412 --threshold 0.2 --changed-by-pr 415 --json",
      shows:
        "the same as one object: status, idea, result, before and after, the outcome, and revert, the status of any revert PR",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the result is recorded, or the idea already had one and is left as it was",
    },
    {
      code: 1,
      meaning:
        "inside the measurement window (the message gives when it can run), or refused: not a harness idea, no merged change in the ledger, the environment does not name the sender, or a gh call failed",
    },
    {
      code: 2,
      meaning:
        "--idea is missing, or --threshold or --changed-by-pr is not valid",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "when it records: writes the outcome into the idea, comments on its issue, sets the outcome label, closes the issue and appends the outcome to the ledger; a refuted or inconclusive result opens a follow-up idea. An inconclusive change stays in place, flagged outcome:inconclusive, with no revert. A refuted change gets a revert PR, once per idea and recorded as a harness-change-reverted ledger event, only when the automatic-revert flag is on in the local overlay: prepared on a branch off main, declaring no-behaviour-change, and never merged (the judge merges it); a change that edited the guardrail inventory is left to guardrail request. Inside the window, or on an idea with an outcome, nothing is written",
  },
  seeAlso: ["outcome record", "flow report", "guardrail request"],
};

export const evaluateCommand: Command = {
  help: evaluateHelp,
  summary:
    "judge a harness idea after its measurement window and record it confirmed, refuted or inconclusive",
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
