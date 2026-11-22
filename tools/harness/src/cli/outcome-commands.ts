import { IdeaError, IdeaRepository } from "../idea/index.js";
import {
  closeOutcome,
  labelFor,
  OUTCOME_KINDS,
  OUTCOME_SOURCES,
  parseOutcome,
  RESULTS,
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

function ideaRef(context: CommandContext, verb: string): string {
  const ref = text(context.options, "idea")?.trim();
  if (ref === undefined || ref === "") {
    throw new IdeaError(
      `Missing --idea; run \`harness outcome ${verb} --idea <number or slug>\`, or \`harness idea list\` to see the ideas.`,
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

/** Logs the idea's outcome event once, however many reruns: a failed ledger write is repaired by `close`. */
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
        `The outcome was published, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness outcome close --idea ${done.idea}\` to record the event.`,
      );
    }
  }
}

async function conclusion(context: CommandContext, verb: "record" | "close") {
  const { deps } = context;
  const sender = senderFrom(deps.env, `outcome ${verb}`);
  if ("error" in sender) {
    throw new IdeaError(sender.error);
  }
  const ledger = await withLedger(context);
  const ref = ideaRef(context, verb);
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
  const done: Concluded =
    verb === "record"
      ? await recordOutcome(
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
        )
      : await closeOutcome(ctx, ref);
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
  when: "When an idea has a measured result and no outcome yet: a live run, a journal entry, an eval record, a comparison, or an owner waiver.",
  whenNot:
    "For a harness idea whose measurement window has passed: evaluate measures it and records the outcome itself. An outcome is recorded once; to finish publishing one already recorded, use outcome close.",
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
    lock: "The chart lock the proof ran on: main or release. It needs flag, environment, live-run as the source, and charts.",
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
        "the outcome is recorded and published; the output names the result and the issue",
    },
    {
      code: 1,
      meaning:
        "refused: a flag is missing or not valid, the idea has no issue or already has an outcome, a gh call failed, or the ledger rejected the event; the message names the fix",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "writes the Outcome section into the idea's file, and creates the follow-up idea for a refuted or inconclusive result; comments on the issue (the comment opens with the sender's line), sets one outcome label in place of any other, closes the issue; appends one outcome event to the ledger unless the idea has one. A refusal before the write changes nothing; a failed publish leaves the outcome recorded for outcome close",
  },
  seeAlso: ["outcome close", "evaluate", "idea list"],
};

const record: Command = {
  help: recordHelp,
  summary: `record an idea's measured outcome in its markdown, post it to the issue with one outcome:* label, close the issue, and open a follow-up idea when refuted or inconclusive (--idea --kind ${OUTCOME_KINDS.join("|")} --source ${OUTCOME_SOURCES.join("|")} --evidence <reference> --result ${RESULTS.join("|")} --summary <text> [--flag <name> --environment <env>, only on a live-run or owner-waiver verification; owner-waiver needs --kind verification and --evidence a GitHub comment URL] [--lock main|release --charts '<name>=<version>@sha256:<digest>; ...', the chart lock a live flag proof ran on and its charts, so activation can compare a main lock with the release lock] [--ledger])`,
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
    return guarded(context, () => conclusion(context, "record"));
  },
};

const closeHelp: CommandHelp = {
  purpose:
    "Finishes publishing an idea's recorded outcome: its comment, its one outcome label and the closed issue, each step skipped when it is already done. It records no new result.",
  when: "When outcome record stopped partway, because a gh call or the ledger write failed, or when an issue with a recorded outcome is still open.",
  whenNot:
    "When no outcome is recorded yet: it refuses with no gh call, so record one with outcome record first.",
  flags: {
    idea: "The idea's number or slug, as harness idea list shows it.",
    ledger:
      "A ledger file to append the outcome event to when it is missing, relative to the working directory; by default the shared ledger in the main checkout.",
  },
  examples: [
    {
      command: "harness outcome close --idea 412",
      shows:
        "the result and the issue URL once the issue is closed; a rerun on a finished issue makes no gh write",
    },
    {
      command: "harness outcome close --idea 412 --json",
      shows:
        "the same as one object: idea, result, issue, followUp when there is one, and published, naming which of commented, labelled and closed this run did",
    },
  ],
  exits: [
    {
      code: 0,
      meaning: "the issue is brought in line with the recorded outcome",
    },
    {
      code: 1,
      meaning:
        "refused: no outcome is recorded, the recorded line is not one the outcome tool wrote, the idea has no issue, or a gh call failed; the message names the fix",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "posts the outcome comment, sets the outcome label and closes the issue, each only when not already done; creates the follow-up idea for a refuted or inconclusive result when it does not exist yet, else reuses it; appends the outcome event to the ledger when the idea has none. It never changes the recorded result",
  },
  seeAlso: ["outcome record", "idea list"],
};

const close: Command = {
  help: closeHelp,
  summary:
    "finish closing an idea whose outcome is recorded (comment, one outcome:* label, close); refused with no gh call when no outcome is recorded (--idea [--ledger])",
  options: { idea: "string", ledger: "string" },
  run(context) {
    return guarded(context, () => conclusion(context, "close"));
  },
};

export const outcomeCommands: Record<string, Command> = { record, close };
