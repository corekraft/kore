import type { CommandContext } from "../runtime/index.js";
import { failed, prNumber, repoOf } from "./judge-shared.js";
import {
  CHECKS_BOUND_MS,
  CHECKS_POLL_MS,
  readChecks,
  waitForChecks,
  type ChecksReport,
} from "./pr-checks.js";

const USAGE =
  "Run `harness pr checks <pr> [--wait] [--json]`: green exits 0, red exits 1, pending exits 2.";

/** The exit code each settled state gives: green 0, red 1, still pending at the bound 2. */
const EXIT = { green: 0, red: 1, pending: 2 } as const;

const NEXT =
  "Print RESULT with CI pending; the driver polls with ledger poll-github.";

function render(pr: number, wait: boolean, result: ChecksReport): string {
  if (result.state === "green") {
    return `green: ${result.checks.length} of ${result.checks.length} checks passed on PR #${pr}\n`;
  }
  if (result.state === "red") {
    const lines = result.checks
      .filter((c) => c.outcome === "fail")
      .map((c) => `  ${c.name} ${c.url}\n`)
      .join("");
    const count = result.failed.length;
    return `red: ${count} failed ${count === 1 ? "check" : "checks"} on PR #${pr}: ${result.failed.join(", ")}\n${lines}`;
  }
  const after = wait ? ` after ${CHECKS_BOUND_MS / 60_000} minutes` : "";
  return result.checks.length === 0
    ? `pending: no checks reported on PR #${pr} yet${after}. ${NEXT}\n`
    : `pending: CI still running on PR #${pr}${after}: ${result.pending.join(", ")}. ${NEXT}\n`;
}

/**
 * `harness pr checks <pr> [--wait]`: reads the PR's check runs through gh, read-only. Without
 * --wait it reads once; with it, it polls on the injected clock until the checks settle or
 * the placeholder bound passes, so the call stays under the foreground limit and never sleeps
 * through the runner. Prints the state, the failed checks with their URLs, or the pending
 * ones; --json prints the same as one object.
 */
export async function prChecksRun(context: CommandContext): Promise<number> {
  const { deps, json, options } = context;
  try {
    const pr = prNumber(context.operand, USAGE);
    const repo = await repoOf(context);
    const root = await deps.root();
    const wait = options["wait"] === true;
    const result = await waitForChecks(
      () => readChecks(deps.runner, root, repo, pr),
      deps.clock,
      { wait, boundMs: CHECKS_BOUND_MS, pollMs: CHECKS_POLL_MS },
    );
    deps.stdout(
      json
        ? `${JSON.stringify({
            state: result.state,
            pr,
            failed: result.failed,
            pending: result.pending,
            checks: result.checks,
          })}\n`
        : render(pr, wait, result),
    );
    return EXIT[result.state];
  } catch (error) {
    return failed(context, error);
  }
}
