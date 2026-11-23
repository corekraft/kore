import { IdeaError, IdeaRepository } from "../idea/index.js";
import {
  labelFor,
  parseOutcome,
  recordOutcome,
  type Concluded,
} from "../outcome/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Command, CommandContext, CommandHelp } from "../runtime/index.js";
import { senderFrom } from "../sender/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

/** Runs an action, turning an IdeaError into an actionable message and a non-zero exit. */
async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<void>,
): Promise<number> {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!(error instanceof IdeaError)) {
      throw error;
    }
    const prefix = json ? `${JSON.stringify({ error: error.message })}\n` : "";
    deps.stderr(`${prefix}${error.message}\n`);
    return FAILED;
  }
}

function ideaRef(context: CommandContext): string {
  const ref = text(context.options, "idea")?.trim();
  if (ref === undefined || ref === "") {
    throw new IdeaError(
      `Missing --idea; run \`harness outcome record --idea <number or slug>\`, or \`harness idea list\` to see the ideas.`,
    );
  }
  return ref;
}

/** Opens the ledger first, so a missing ledger fails before anything is written. */
async function withLedger(context: CommandContext) {
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new IdeaError(opened.error);
  }
  return opened.ledger;
}

/** Logs the idea's outcome event once, however many reruns: a failed ledger write is repaired by rerunning `record`. */
export async function logOutcome(
  ledger: Ledger,
  deps: CommandContext["deps"],
  done: Concluded,
): Promise<void> {
  const logged = await ledger.list({ idea: done.idea, kind: "outcome" });
  if (logged.events.length === 0) {
    const event = await ledger.record({
      source: "github",
      kind: "outcome",
      occurredAt: deps.clock.now().toISOString(),
      idea: done.idea,
      label: labelFor(done.result),
      number: Number(/(\d+)$/.exec(done.issue)?.[1]),
    });
    if (!event.ok) {
      throw new IdeaError(
        `The outcome was published, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness outcome record --idea ${done.idea}\` with the same flags to record the event.`,
      );
    }
  }
}

async function conclusion(context: CommandContext) {
  const { deps } = context;
  const sender = senderFrom(deps.env, "outcome record");
  if ("error" in sender) {
    throw new IdeaError(sender.error);
  }
  const ledger = await withLedger(context);
  const ref = ideaRef(context);
  const root = await deps.root().catch((cause: unknown) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  const ctx = {
    repo: new IdeaRepository(deps.fs, deps.clock, root),
    runner: deps.runner,
    clock: deps.clock,
    root,
    sender,
  };
  const done = await recordOutcome(
    ctx,
    ref,
    parseOutcome({
      kind: text(context.options, "kind"),
      source: text(context.options, "source"),
      result: text(context.options, "result"),
      evidence: text(context.options, "evidence"),
      summary: text(context.options, "summary"),
      flag: text(context.options, "flag"),
      environment: text(context.options, "environment"),
      lock: text(context.options, "lock"),
      charts: text(context.options, "charts"),
    }),
  );
  await logOutcome(ledger, deps, done);
  deps.stdout(
    context.json
      ? `${JSON.stringify(done)}\n`
      : `Idea ${done.idea} ${done.result}; issue closed: ${done.issue}${done.followUp === undefined ? "" : `\nFollow-up idea: ${done.followUp}`}\n`,
  );
}

const recordHelp: CommandHelp = {
  purpose:
    "Records an idea's measured outcome: writes it into the idea's Outcome section, publishes it to the idea's issue as one comment with one outcome label, closes the issue, and logs the outcome to the ledger. A refuted or inconclusive result also opens a follow-up idea.",
  when: "When an idea has a measured result and no outcome yet: a live run, a journal entry, an eval record, a comparison, or an owner waiver. Also when an earlier run stopped partway, because a gh call or the ledger write failed: rerun it with the same flags.",
  whenNot:
    "For a harness idea whose measurement window has passed: evaluate measures it and records the outcome itself. An outcome is recorded once, and rerunning the command on a recorded idea never changes the result.",
  flags: {
    idea: "The idea's number or slug, as harness idea list shows it.",
    kind: "The kind of measurement: experiment, usage or verification. A flag outcome needs verification.",
    source:
      "Where the measurement came from: live-run, journal, eval-history, comparison or owner-waiver. An owner-waiver needs kind verification and an evidence that is the owner's GitHub comment URL.",
    evidence:
      "The run, journal entry, eval record or comparison the result was measured on, on one line. It must not contain an HTML comment.",
    result: "The result: confirmed, refuted or inconclusive.",
    summary:
      "What was observed against the idea's expected outcome. It must not contain an HTML comment, start a line with a # heading, or start a line with a - Name: field.",
    flag: "The feature flag a live verification proves: lowercase letters, digits and hyphens. It needs environment, and kind verification from live-run or owner-waiver.",
    environment: "The environment the flag was proved in. It needs flag.",
    lock: "The chart lock the proof ran on: main or release. It needs flag, environment, live-run as the source, and charts, so activation can compare a main lock with the release lock.",
    charts:
      "The charts the proof ran on, as name=version@sha256:<64 hex digits>, separated by semicolons. It needs lock.",
    ledger:
      "A ledger file to append the outcome event to, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command:
        'harness outcome record --idea 412 --kind experiment --source comparison --result confirmed --evidence "flow report, 14 days either side of the change" --summary "tokens per idea fell 22%, past the 10% threshold"',
      shows:
        "the outcome written into the idea, its issue commented, labelled outcome:confirmed and closed, and the result printed with the issue URL",
    },
    {
      command:
        'harness outcome record --idea 412 --kind verification --source live-run --result confirmed --evidence "nightly run 1204" --summary "the flag ran live in the local environment" --flag automatic-revert --environment local',
      shows:
        "a flag proof recorded for automatic-revert in local, the record a later flag activate reads",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the outcome is recorded and published, or an earlier partial publish is finished; the output names the result and the issue",
    },
    {
      code: 1,
      meaning:
        "refused: a flag is missing or not valid, the idea has no issue, the idea already has an outcome with another result, a gh call failed, or the ledger rejected the event; the message names the fix",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "writes the Outcome section into the idea's file, and creates the follow-up idea for a refuted or inconclusive result; comments on the issue (the comment opens with the sender's line), sets one outcome label in place of any other, closes the issue; appends one outcome event to the ledger unless the idea has one. A refusal before the write changes nothing; a failed publish leaves the outcome recorded, and rerunning the command with the same flags finishes it: comment, label and close, each skipped when already done, the follow-up idea reused, the ledger event written when missing",
  },
  seeAlso: ["evaluate", "idea list"],
};

const record: Command = {
  help: recordHelp,
  summary:
    "record an idea's measured outcome, publish it to the issue and close it; a refuted or inconclusive result opens a follow-up idea",
  options: {
    idea: "string",
    kind: "string",
    source: "string",
    evidence: "string",
    result: "string",
    summary: "string",
    flag: "string",
    environment: "string",
    lock: "string",
    charts: "string",
    ledger: "string",
  },
  run(context) {
    return guarded(context, () => conclusion(context));
  },
};

export const outcomeCommands: Record<string, Command> = { record };
