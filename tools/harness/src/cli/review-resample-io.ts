import { JudgeError } from "../judge/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext, RunResult } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";
import type { ResampleIo } from "./review-resample-command.js";
import { settledReads, type Backend } from "./review-settled.js";

const HARNESS = "skills/bin/harness.mjs";

/** Appends a review.run for a re-review: the label names the head, and findings only when a verdict was read. */
async function recordResample(
  occurredAt: string,
  ledger: Ledger,
  pr: number,
  label: string,
  findings?: number,
): Promise<void> {
  const event = await ledger.record({
    source: "claude",
    kind: "review.run",
    occurredAt,
    number: pr,
    label,
    stage: "review",
    ...(findings === undefined ? {} : { findings }),
  });
  if (!event.ok) {
    throw new JudgeError(
      `The review.run event for PR #${pr} was rejected: ${event.message} Fix the ledger, then rerun \`harness review resample\`.`,
    );
  }
}

/**
 * The real ports and events of `review resample`: the shared ledger's events, the reader
 * pane through the `session` tools (so its launch records its tier and reason), its text
 * through herdr on herdr or from its report's summary on hc, and the re-review events
 * through the judge's ledger.
 */
export async function sessionResampleIo(
  context: CommandContext,
  backend: Backend,
): Promise<ResampleIo> {
  const { deps } = context;
  const root = await deps.root();
  const ledger = await openJudgeLedger(context);
  const { events } = await ledger.list({});
  const tool = async (
    command: string,
    args: string[],
    what: string,
  ): Promise<string> => {
    const done: RunResult = await deps.runner.run(command, args, { cwd: root });
    if (done.code !== 0) {
      throw new JudgeError(
        `\`${what}\` failed: ${done.stderr.trim() || "no output"}. Fix that, then rerun \`harness review resample\`.`,
      );
    }
    return done.stdout;
  };
  const harness = (...args: string[]) =>
    tool("node", [HARNESS, ...args], `harness ${args.slice(0, 2).join(" ")}`);
  return {
    events,
    ports: {
      spawn: async (launch) => {
        await harness(
          "session",
          "spawn",
          "--role",
          launch.role,
          "--name",
          launch.name,
          "--brief",
          launch.brief,
          "--model",
          launch.model,
          "--effort",
          launch.effort,
          "--reason",
          launch.reason,
          "--no-wait",
        );
      },
      ...settledReads(harness, tool, backend),
      close: async (name) => {
        await harness("session", "close", name);
      },
      record: (pr, label, findings) =>
        recordResample(
          deps.clock.now().toISOString(),
          ledger,
          pr,
          label,
          findings,
        ),
    },
  };
}
