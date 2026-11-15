import { tmpdir } from "node:os";
import type { Evaluated } from "../evaluate/index.js";
import { IdeaError } from "../idea/index.js";
import type { Ledger } from "../ledger/index.js";
import {
  GitRevert,
  PrepareRevert,
  revertFlagOn,
  type RevertResult,
} from "../revert/index.js";
import type { CommandContext } from "../runtime/index.js";

const KIND = "harness-change-reverted";

/** Prepares the revert of a refuted idea's change; every other outcome, and a flag that is off, prepares nothing. */
export async function prepareRevertFor(
  { deps }: CommandContext,
  ledger: Ledger,
  done: Extract<Evaluated, { status: "recorded" }>,
): Promise<RevertResult> {
  const root = await deps.root();
  const issue = Number(/(\d+)$/.exec(done.concluded.issue)?.[1]);
  const git = new GitRevert(deps.runner, root, tmpdir());
  return await new PrepareRevert({
    flagOn: () => revertFlagOn(deps.fs, root),
    reverted: async (idea) =>
      (await ledger.list({ idea, kind: KIND })).events.length > 0,
    existing: (n) => git.existing(n),
    touchesGuardrail: (pr) => git.touchesGuardrail(pr),
    prepare: (change) => git.prepare(change),
    record: async (idea, number) => {
      const event = await ledger.record({
        source: "claude",
        kind: KIND,
        occurredAt: deps.clock.now().toISOString(),
        idea,
        number,
      });
      if (!event.ok) {
        throw new IdeaError(
          `The revert PR #${number} is open, but its ledger event was rejected: ${event.message} Fix the ledger, then rerun \`harness evaluate\`.`,
        );
      }
    },
  }).run({
    idea: done.idea,
    issue,
    pr: done.changedByPr,
    result: done.result,
  });
}
