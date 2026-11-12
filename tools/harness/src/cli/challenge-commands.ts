import {
  challengeIdea,
  parseObjections,
  RoundLimit,
} from "../challenge/index.js";
import { IdeaError, IdeaRepository } from "../idea/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;

function text(options: CommandContext["options"], key: string) {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

/** Objections come from stdin, one per line; `--approve` is the round with none. */
async function objectionsOf(context: CommandContext): Promise<string[]> {
  const approve = context.options["approve"] === true;
  if (approve) {
    return [];
  }
  const objections = parseObjections(await context.deps.stdin());
  if (objections.length === 0) {
    throw new IdeaError(
      "No objections given: pipe them on stdin, one per line, or pass --approve when the idea has none left.",
    );
  }
  return objections;
}

async function round(context: CommandContext): Promise<void> {
  const { deps } = context;
  const ref = text(context.options, "idea")?.trim();
  if (ref === undefined || ref === "") {
    throw new IdeaError(
      "Missing --idea; run `harness idea challenge --idea <number or slug>`, or `harness idea list` to see the ideas.",
    );
  }
  const objections = await objectionsOf(context);
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new IdeaError(opened.error);
  }
  const root = await deps.root().catch((cause: unknown) => {
    throw new IdeaError(cause instanceof Error ? cause.message : String(cause));
  });
  const done = await challengeIdea(
    {
      repo: new IdeaRepository(deps.fs, deps.clock, root),
      runner: deps.runner,
      root,
    },
    ref,
    objections,
  );
  const event = await opened.ledger.record({
    source: "claude",
    kind: "challenge.round",
    occurredAt: deps.clock.now().toISOString(),
    idea: done.idea,
    stage: "challenge",
    number: done.round,
    label: `objections:${done.objections.length}`,
  });
  if (!event.ok) {
    throw new IdeaError(
      `Round ${done.round} was posted on ${done.issue}, but its ledger event was rejected: ${event.message} Fix the ledger; do not rerun, which would post another round.`,
    );
  }
  deps.stdout(
    context.json
      ? `${JSON.stringify(done)}\n`
      : `Challenge round ${done.round} of 2 posted on ${done.issue}: ${
          done.objections.length === 0
            ? "no open objections"
            : `${done.objections.length} open objection${done.objections.length === 1 ? "" : "s"}`
        }\n`,
  );
}

export const challenge: Command = {
  summary:
    "post one challenge round on the idea's issue and record it (--idea; objections one per line on stdin, or --approve for none; [--ledger]); refuses a third round and lists the open objections for a person",
  options: { idea: "string", approve: "boolean", ledger: "string" },
  async run(context) {
    const { json, deps } = context;
    try {
      await round(context);
      return 0;
    } catch (error) {
      if (!(error instanceof IdeaError)) {
        throw error;
      }
      const detail =
        error instanceof RoundLimit
          ? {
              error: error.message,
              rounds: error.rounds,
              openObjections: error.openObjections,
            }
          : { error: error.message };
      deps.stderr(
        `${json ? `${JSON.stringify(detail)}\n` : ""}${error.message}\n`,
      );
      return FAILED;
    }
  },
};
