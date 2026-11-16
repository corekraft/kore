import { JudgeError, type PrView, type ReviewPorts } from "../judge/index.js";
import type { Ledger } from "../ledger/index.js";
import type { CommandContext, RunResult } from "../runtime/index.js";
import { openJudgeLedger } from "./judge-shared.js";
import { ghReviewIo } from "./review-gh.js";

const HARNESS = "skills/bin/harness.mjs";
const ROLE = "principles-review";

/** Appends a review.run event for the PR, or refuses with the ledger's reason. */
async function recordReviewRun(
  { deps }: CommandContext,
  ledger: Ledger,
  pr: number,
  label: string,
  findings?: number,
): Promise<void> {
  const event = await ledger.record({
    source: "claude",
    kind: "review.run",
    occurredAt: deps.clock.now().toISOString(),
    number: pr,
    label,
    stage: "review",
    ...(findings === undefined ? {} : { findings }),
  });
  if (!event.ok) {
    throw new JudgeError(
      `The review.run event for PR #${pr} was rejected: ${event.message} Fix the ledger, then rerun \`harness review run ${pr}\`.`,
    );
  }
}

/**
 * The real ports of `review run`: the PR through gh, the Reviewer pane through the
 * `session` tools (so its launch records its tier source), its text through herdr, and the
 * review.run events through the judge's ledger.
 */
export async function sessionReviewPorts(
  context: CommandContext,
): Promise<ReviewPorts> {
  const { deps } = context;
  const root = await deps.root();
  const gh = await ghReviewIo(context);
  const ledger = await openJudgeLedger(context);
  const tool = async (
    command: string,
    args: string[],
    what: string,
  ): Promise<string> => {
    const done: RunResult = await deps.runner.run(command, args, { cwd: root });
    if (done.code !== 0) {
      throw new JudgeError(
        `\`${what}\` failed: ${done.stderr.trim() || "no output"}. Fix that, then rerun \`harness review run\`.`,
      );
    }
    return done.stdout;
  };
  const harness = (...args: string[]) =>
    tool("node", [HARNESS, ...args], `harness ${args.slice(0, 2).join(" ")}`);
  return {
    view: (pr): Promise<PrView> => gh.view(pr),
    comment: (pr, body) => gh.comment(pr, body),
    spawn: async (name, brief) => {
      await harness(
        "session",
        "spawn",
        "--role",
        ROLE,
        "--name",
        name,
        "--brief",
        brief,
        "--no-wait",
      );
    },
    wait: async (name) => {
      const out = await harness("session", "wait", name, "--json");
      const waited = JSON.parse(out) as {
        outcome: "done" | "blocked";
        paneId: string;
      };
      return { outcome: waited.outcome, paneId: waited.paneId };
    },
    read: (paneId) =>
      tool(
        "herdr",
        ["pane", "read", paneId, "--source", "recent-unwrapped"],
        `herdr pane read ${paneId}`,
      ),
    close: async (name) => {
      await harness("session", "close", name);
    },
    record: (pr, label, findings) =>
      recordReviewRun(context, ledger, pr, label, findings),
  };
}
