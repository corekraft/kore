// The children wait of `harness wait --pr` on hc (plan 16, Step 6). Each pull request gets one `gh pr checks --watch
// --fail-fast` terminal, a child of the caller, and the wait is one `wait --children any` for the next news among the
// caller's children. Each wake re-reads the checks with readChecks, so the watcher's exit code is never trusted, and a
// watcher still running when the wait ends is killed. Only a --pr target from an hc terminal takes this path.
// Docs: infra/plans/16-hc-native-sessions.md

import type { CliDeps } from "../runtime/index.js";
import { terminalsFor } from "../session/index.js";
import type { Terminal, Terminals } from "../terminal/index.js";
import {
  childrenPause,
  messageOf,
  pollPause,
  type Pause,
} from "./wait-pause.js";

export { pollPause, type Pause } from "./wait-pause.js";

/** The caller's terminals and its own terminal id, the parent the watchers start under. */
export interface HcChildren {
  terminals: Terminals;
  self: string;
}

/** Where a pull request's checks are read: the checkout root and the repository. */
interface Place {
  root: string;
  repo: string;
}

/** hc's listing of hc errors that mean a watcher already ended and was removed, which is no failure to stop it. */
const ENDED: readonly string[] = ["not-found", "not-live"];

/**
 * The caller's children when this wait can run on them: a --pr target, no idea target, and the caller is an hc
 * terminal. Undefined keeps the loop that polls the checks itself.
 */
export async function hcChildrenFor(
  deps: CliDeps,
  targets: { prs: readonly number[]; ideas: number },
): Promise<HcChildren | undefined> {
  if (targets.prs.length === 0 || targets.ideas > 0) {
    return undefined;
  }
  const terminals = terminalsFor(deps);
  const self = terminals.self();
  return self === undefined ? undefined : { terminals, self };
}

/**
 * Starts one watcher per pull request as a child of the caller, removed when it ends and with no notice to the caller.
 * Every name is checked before any watcher starts: a live watch of the same pull request is reused, since it is a child
 * of the caller too, and a watch that has ended but is still listed is refused with the command that removes it.
 * A watcher that cannot start stops the ones already started and fails the wait, naming its pull request.
 */
export async function startPrWatchers(
  terminals: Terminals,
  self: string,
  place: Place,
  prs: readonly number[],
  stderr: (text: string) => void,
): Promise<string[]> {
  const listed = await terminals.list({ childrenOf: self });
  if ("error" in listed) {
    throw new Error(
      `could not list the caller's watches on hc: ${messageOf(listed)}`,
    );
  }
  const named = new Map<string, Terminal>();
  for (const terminal of listed) {
    if (terminal.name !== undefined) {
      named.set(terminal.name, terminal);
    }
  }
  const starting: number[] = [];
  for (const pr of prs) {
    const holder = named.get(`pr-watch-${pr}`);
    if (holder === undefined) {
      starting.push(pr);
    } else if (holder.state !== "live") {
      throw new Error(
        `PR #${pr} has a watch that already ended, pr-watch-${pr} (terminal ${holder.id}): remove it with hc rm ${holder.id}, then wait again`,
      );
    }
  }
  const ids: string[] = [];
  for (const pr of starting) {
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
      await stopWatchers(terminals, ids, stderr);
      throw new Error(`could not watch PR #${pr} on hc: ${messageOf(started)}`);
    }
    ids.push(started.id);
  }
  return ids;
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
  const ids = await startPrWatchers(terminals, self, place, prs, deps.stderr);
  try {
    return await run(childrenPause({ terminals, self, clock: deps.clock }));
  } finally {
    await stopWatchers(terminals, ids, deps.stderr);
  }
}
