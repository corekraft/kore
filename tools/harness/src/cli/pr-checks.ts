import { JudgeError } from "../judge/index.js";
import type { Clock, Runner } from "../runtime/index.js";

/**
 * The longest a `pr checks --wait` call may run. A placeholder under the host's 10 minute
 * foreground limit, to be set from measured CI duration (issue #863).
 */
export const CHECKS_BOUND_MS = 540_000;
/** How long the wait sleeps between reads of the PR's checks. */
export const CHECKS_POLL_MS = 15_000;

export type Outcome = "pass" | "fail" | "pending";
export type Settled = "green" | "red" | "pending";

export interface CheckRun {
  name: string;
  outcome: Outcome;
  url: string;
}

export interface ChecksReport {
  state: Settled;
  checks: CheckRun[];
  failed: string[];
  pending: string[];
}

const FIX =
  "Check `gh auth status` and that the PR number is right, then rerun `harness pr checks`.";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * One entry of gh's statusCheckRollup. A check run carries a status and a conclusion; a
 * commit status carries only a state. A check run that has not completed is pending, and a
 * completed one passes only when its conclusion is success, neutral or skipped.
 */
function outcomeOf(entry: Record<string, unknown>): Outcome {
  if (!("status" in entry) && typeof entry["state"] === "string") {
    const state = entry["state"].toUpperCase();
    if (state === "SUCCESS") {
      return "pass";
    }
    return state === "PENDING" || state === "EXPECTED" ? "pending" : "fail";
  }
  if (text(entry["status"]).toUpperCase() !== "COMPLETED") {
    return "pending";
  }
  return ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(
    text(entry["conclusion"]).toUpperCase(),
  )
    ? "pass"
    : "fail";
}

/** The checks on a PR, from gh's parsed `pr view --json statusCheckRollup`; none when the rollup lists none. */
export function checkRuns(view: Record<string, unknown>): CheckRun[] {
  const rollup = Array.isArray(view["statusCheckRollup"])
    ? (view["statusCheckRollup"] as Record<string, unknown>[])
    : [];
  return rollup.map((entry) => ({
    name: text(entry["name"] ?? entry["context"]),
    outcome: outcomeOf(entry),
    url: text(entry["detailsUrl"] ?? entry["targetUrl"]),
  }));
}

/** The state of a set of checks, from how many there are and how many failed or are pending. */
function stateOf(total: number, failed: number, pending: number): Settled {
  if (total === 0) {
    return "pending";
  }
  if (failed > 0) {
    return "red";
  }
  return pending > 0 ? "pending" : "green";
}

/**
 * Green only when every check passes. Red as soon as one fails, naming only the failures,
 * even while others still run. Pending while checks run or while none has appeared yet, so
 * a PR whose checks are not created yet is never read as green.
 */
export function settle(checks: CheckRun[]): ChecksReport {
  const failed = checks.filter((c) => c.outcome === "fail").map((c) => c.name);
  const pending = checks
    .filter((c) => c.outcome === "pending")
    .map((c) => c.name);
  return {
    state: stateOf(checks.length, failed.length, pending.length),
    checks,
    failed,
    pending,
  };
}

/** Reads the PR's checks through gh in the named repository, from the checkout root. Refuses a gh error or unreadable output rather than reading either as no checks. */
export async function readChecks(
  runner: Runner,
  root: string,
  repo: string,
  pr: number,
): Promise<ChecksReport> {
  const done = await runner.run(
    "gh",
    ["pr", "view", String(pr), "--repo", repo, "--json", "statusCheckRollup"],
    { cwd: root },
  );
  if (done.code !== 0) {
    throw new JudgeError(
      `gh pr view failed for PR #${pr}: ${done.stderr.trim()}. ${FIX}`,
    );
  }
  let view: unknown;
  try {
    view = JSON.parse(done.stdout);
  } catch {
    view = undefined;
  }
  if (typeof view !== "object" || view === null || Array.isArray(view)) {
    throw new JudgeError(`gh returned unreadable output for PR #${pr}. ${FIX}`);
  }
  return settle(checkRuns(view as Record<string, unknown>));
}

export interface WaitOptions {
  /** Without it the first read is the answer; with it, the wait polls until settled or the bound. */
  wait: boolean;
  boundMs: number;
  pollMs: number;
}

/**
 * Reads the checks once, or, with `wait`, again every poll interval until they settle or
 * the next read would pass the bound. The clock is injected, so a wait is measured without a
 * real timer, and the last read at the bound is the answer when checks are still pending.
 */
export async function waitForChecks(
  read: () => Promise<ChecksReport>,
  clock: Clock,
  { wait, boundMs, pollMs }: WaitOptions,
): Promise<ChecksReport> {
  const start = clock.now().getTime();
  for (;;) {
    const result = await read();
    if (!wait || result.state !== "pending") {
      return result;
    }
    if (clock.now().getTime() - start + pollMs > boundMs) {
      return result;
    }
    await clock.sleep(pollMs);
  }
}
