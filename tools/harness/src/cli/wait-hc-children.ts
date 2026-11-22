// The children wait of `harness wait --pr` on hc (plan 16, Step 6). Each pull request gets one `gh pr checks --watch
// --fail-fast` terminal, a child of the caller, and the wait is one `wait --children any` for the next news among the
// caller's children. Each wake re-reads the checks with readChecks, so the watcher's exit code is never trusted, and a
// watcher still running when the wait ends is killed. Only a --pr target on hc-sessions from an hc terminal takes this path.
// Docs: infra/plans/16-hc-native-sessions.md

import type { CliDeps, Clock } from "../runtime/index.js";
import { hcSessionsOn, terminalsFor } from "../session/index.js";
import type { TerminalError, Terminals } from "../terminal/index.js";
import { CHECKS_POLL_MS } from "./pr-checks.js";

/** The caller's terminals and its own terminal id, the parent the watchers start under. */
export interface HcChildren {
  terminals: Terminals;
  self: string;
}

/** Waits for the next news, for at most the remaining milliseconds: resolves true when the bound passed with nothing new. */
export type Pause = (remainingMs: number) => Promise<boolean>;

/** Where a pull request's checks are read: the checkout root and the repository. */
interface Place {
  root: string;
  repo: string;
}

/** hc's listing of hc errors that mean a watcher already ended and was removed, which is no failure to stop it. */
const ENDED: readonly string[] = ["not-found", "not-live"];

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/**
 * The caller's children when this wait can run on them: a --pr target, no idea target, hc-sessions on, and the caller is
 * an hc terminal. Undefined keeps the loop that polls the checks itself.
 */
export async function hcChildrenFor(
  deps: CliDeps,
  targets: { prs: readonly number[]; ideas: number },
): Promise<HcChildren | undefined> {
  if (
    targets.prs.length === 0 ||
    targets.ideas > 0 ||
    !(await hcSessionsOn(deps))
  ) {
    return undefined;
  }
  const terminals = terminalsFor(deps);
  const self = terminals.self();
  return self === undefined ? undefined : { terminals, self };
}

/**
 * Starts one watcher per pull request as a child of the caller, removed when it ends and with no notice to the caller.
 * A watcher that cannot start stops the ones already started and fails the wait, naming its pull request.
 */
export async function startPrWatchers(
  terminals: Terminals,
  self: string,
  place: Place,
  prs: readonly number[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const pr of prs) {
    const started = await terminals.run({
      argv: [
        "gh",
        "pr",
        "checks",
        String(pr),
        "--watch",
        "--fail-fast",
        "-R",
        place.repo,
      ],
      name: `pr-watch-${pr}`,
      cwd: place.root,
      parent: self,
      notify: false,
      rm: true,
    });
    if ("error" in started) {
      await stopWatchers(terminals, ids, () => undefined);
      throw new Error(`could not watch PR #${pr} on hc: ${messageOf(started)}`);
    }
    ids.push(started.id);
  }
  return ids;
}

/** The pause that waits on the caller's children. A wake that came at once is followed by the rest of a poll interval, so a finished child that stays listed cannot spin the loop. */
export function childrenPause(deps: {
  terminals: Terminals;
  self: string;
  clock: Clock;
}): Pause {
  return async (remainingMs) => {
    if (remainingMs <= 0) {
      return true;
    }
    const before = deps.clock.now().getTime();
    const waited = await deps.terminals.wait(
      { children: "any", of: deps.self },
      remainingMs,
    );
    if ("error" in waited) {
      if (waited.error.kind === "timeout") {
        return true;
      }
      throw new Error(messageOf(waited));
    }
    const rest = CHECKS_POLL_MS - (deps.clock.now().getTime() - before);
    if (rest > 0) {
      await deps.clock.sleep(rest);
    }
    return false;
  };
}

/** The pause that sleeps one poll interval, and passes the bound when less than one interval remains. */
export function pollPause(clock: Clock): Pause {
  return async (remainingMs) => {
    if (remainingMs < CHECKS_POLL_MS) {
      return true;
    }
    await clock.sleep(CHECKS_POLL_MS);
    return false;
  };
}

/** Kills each watcher still running. One that already ended is not an error; another failure is named on stderr. */
export async function stopWatchers(
  terminals: Terminals,
  ids: readonly string[],
  stderr: (text: string) => void,
): Promise<void> {
  for (const id of ids) {
    const killed = await terminals.kill(id);
    if ("error" in killed && !ENDED.includes(killed.error.kind)) {
      stderr(`could not stop the watch ${id}: ${killed.error.message}\n`);
    }
  }
}

/**
 * Runs the wait with the pause it needs: on the caller's children when this wait can run on them, else with the checks'
 * own poll interval. Undefined children keep the loop, so a wait that cannot use hc behaves exactly as before.
 */
export async function withPause(
  deps: CliDeps,
  targets: { prs: readonly number[]; ideas: number },
  place: Place,
  run: (pause: Pause) => Promise<number>,
): Promise<number> {
  const children = await hcChildrenFor(deps, targets);
  if (children === undefined) {
    return await run(pollPause(deps.clock));
  }
  return await watchOnChildren(children, deps, place, targets.prs, run);
}

/** Runs the wait with the watchers started, and stops them when it returns or throws. */
export async function watchOnChildren(
  children: HcChildren,
  deps: Pick<CliDeps, "clock" | "stderr">,
  place: Place,
  prs: readonly number[],
  run: (pause: Pause) => Promise<number>,
): Promise<number> {
  const { terminals, self } = children;
  const ids = await startPrWatchers(terminals, self, place, prs);
  try {
    return await run(childrenPause({ terminals, self, clock: deps.clock }));
  } finally {
    await stopWatchers(terminals, ids, deps.stderr);
  }
}
