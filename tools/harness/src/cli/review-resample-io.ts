import { JudgeError } from "../judge/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext, RunResult } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";
import type { ResampleIo } from "./review-resample-command.js";

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
 * through herdr, and the re-review events through the judge's ledger.
 */
export async function sessionResampleIo(
  context: CommandContext,
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
      ...paneReads(harness, tool),
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
type Tool = (command: string, args: string[], what: string) => Promise<string>;

/**
 * The wait and read ports: a settled reader's pane is kept under its session name, so the run reads by name only,
 * and read refuses a session it has not waited for.
 */
function paneReads(
  harness: (...args: string[]) => Promise<string>,
  tool: Tool,
): Pick<ResampleIo["ports"], "wait" | "read"> {
  const panes = new Map<string, string>();
  return {
    wait: async (name) => {
      const waited = JSON.parse(
        await harness("session", "wait", name, "--json"),
      ) as { outcome: "done" | "blocked"; paneId: string };
      panes.set(name, waited.paneId);
      return { outcome: waited.outcome };
    },
    read: async (name) => {
      const paneId = panes.get(name);
      if (paneId === undefined) {
        throw new JudgeError(
          `The reader's session ${name} has not settled, so its text is not read. Wait for it first with \`harness session wait ${name}\`.`,
        );
      }
      return tool(
        "herdr",
        ["pane", "read", paneId, "--source", "recent-unwrapped"],
        `herdr pane read of session ${name}`,
      );
    },
  };
}
