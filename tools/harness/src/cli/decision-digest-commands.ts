// `decision digest`: the owner digest (ADR 0120). It posts at most one a day to the one issue pinned
// for it, listing the open reserved questions, blocking first, and saying when the tick is not
// running. It is behind the decision-advisor flag and never types into a pane.
import {
  DecisionError,
  decisionFlagOn,
  pinnedDigestIssue,
  postDigest,
  type DigestPorts,
  type DigestResult,
} from "../decision/index.js";
import { FlagError } from "../flag/index.js";
import type { Ledger } from "../ledger/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import * as help from "./decision-help.js";

const FAILED = 1;

/** Prints an expected failure as the command's message, plus a JSON object first under --json. */
function fail({ json, deps }: CommandContext, message: string, code: number) {
  deps.stderr(
    `${json ? `${JSON.stringify({ error: message })}\n` : ""}${message}\n`,
  );
  return code;
}

function ports(context: CommandContext, root: string, ledger: Ledger) {
  const { deps } = context;
  const result: DigestPorts = {
    env: deps.env,
    flagOn: () => decisionFlagOn(deps.fs, root),
    pinned: () =>
      pinnedDigestIssue((args) => deps.runner.run("gh", args, { cwd: root })),
    async post({ number, repo }, body) {
      const done = await deps.runner.run(
        "gh",
        ["issue", "comment", number, "--repo", repo, "--body", body],
        { cwd: root },
      );
      if (done.code !== 0) {
        throw new DecisionError(
          `gh issue comment failed for issue #${number}: ${done.stderr.trim()}. Check \`gh auth status\`, then rerun the same command.`,
        );
      }
      return done.stdout.trim();
    },
    async record(at) {
      const written = await ledger.record({
        source: "claude",
        kind: "decision.digest",
        occurredAt: at,
      });
      return written.ok
        ? { ok: true }
        : { ok: false, message: written.message };
    },
  };
  return result;
}

/** What the person reads: the post, the wait until the next one, or that nothing needed saying. */
function announce(result: DigestResult): string {
  if (!result.posted) {
    return result.reason === "not-due"
      ? `The owner digest is not due until ${result.nextAt}.`
      : "Nothing to report: no open reserved question, and the tick is running.";
  }
  const gap = result.tickGap ? ", the tick is not running" : "";
  return `Posted the owner digest: ${result.commentUrl} (${result.open} open, ${result.blocking} blocking${gap}).`;
}

const digest: Command = {
  summary: "post the owner digest to the pinned issue, at most once a day",
  options: {
    ledger: "string",
  },
  help: help.digestHelp,
  async run(context) {
    const { deps, json } = context;
    try {
      // The ledger opens first, so a missing ledger fails before anything is posted.
      const opened = await openLedger(context);
      if ("error" in opened) {
        return fail(context, opened.error, FAILED);
      }
      const { events } = await opened.ledger.list({});
      const result = await postDigest(
        ports(context, await deps.root(), opened.ledger),
        { events, now: deps.clock.now() },
      );
      deps.stdout(
        json ? `${JSON.stringify(result)}\n` : `${announce(result)}\n`,
      );
      return 0;
    } catch (error) {
      if (error instanceof DecisionError || error instanceof FlagError) {
        return fail(context, error.message, FAILED);
      }
      throw error;
    }
  },
};

/** The digest command, merged into the `decision` group. */
export const digestCommands: Record<string, Command> = { digest };
