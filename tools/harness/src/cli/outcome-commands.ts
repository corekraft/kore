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
import type { Command, CommandContext } from "../runtime/index.js";
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

async function conclusion(context: CommandContext, verb: "record" | "close") {
  const ledger = await withLedger(context);
  const ref = ideaRef(context, verb);
  const { deps } = context;
  const root = await deps.root().catch((cause: unknown) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  const ctx = {
    repo: new IdeaRepository(deps.fs, deps.clock, root),
    runner: deps.runner,
    clock: deps.clock,
    root,
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
          }),
        )
      : await closeOutcome(ctx, ref);
  // One event per idea, however many reruns: a failed ledger write is repaired by `close`.
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
  deps.stdout(
    context.json
      ? `${JSON.stringify(done)}\n`
      : `Idea ${done.idea} ${done.result}; issue closed: ${done.issue}${done.followUp === undefined ? "" : `\nFollow-up idea: ${done.followUp}`}\n`,
  );
}

const record: Command = {
  summary: `record an idea's measured outcome in its markdown, post it to the issue with one outcome:* label, close the issue, and open a follow-up idea when refuted or inconclusive (--idea --kind ${OUTCOME_KINDS.join("|")} --source ${OUTCOME_SOURCES.join("|")} --evidence <reference> --result ${RESULTS.join("|")} --summary <text> [--flag <name> --environment <env>, only on a live-run verification] [--ledger])`,
  options: {
    idea: "string",
    kind: "string",
    source: "string",
    evidence: "string",
    result: "string",
    summary: "string",
    flag: "string",
    environment: "string",
    ledger: "string",
  },
  run(context) {
    return guarded(context, () => conclusion(context, "record"));
  },
};

const close: Command = {
  summary:
    "finish closing an idea whose outcome is recorded (comment, one outcome:* label, close); refused with no gh call when no outcome is recorded (--idea [--ledger])",
  options: { idea: "string", ledger: "string" },
  run(context) {
    return guarded(context, () => conclusion(context, "close"));
  },
};

export const outcomeCommands: Record<string, Command> = { record, close };
