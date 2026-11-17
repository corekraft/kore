import { join, resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  HarnessCliError,
  TICK_STARTED,
  TICK_STOPPED,
  TickLoop,
  tickFlagOn,
} from "../orchestrator/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

const HARNESS = "skills/bin/harness.mjs";

const FLAG_OFF =
  "The orchestrator-tick flag is off in the local overlay, so no idea was advanced.\n";

/**
 * `orchestrate tick --loop`: the loop wired to the machine. Each pass is this
 * checkout's `orchestrate tick` in a child process; the heartbeat and stop events
 * go to the main checkout's ledger, where status reads them.
 */
export async function runTickLoop(
  deps: CliDeps,
  root: string,
  idea: string | undefined,
): Promise<number> {
  const main = (await mainRoot(deps)) ?? root;
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    resolve(main, DEFAULT_LEDGER),
  );
  const beat = async (kind: typeof TICK_STARTED | typeof TICK_STOPPED) => {
    const written = await ledger.record({
      source: "claude",
      kind,
      occurredAt: deps.clock.now().toISOString(),
    });
    if (!written.ok) {
      throw new HarnessCliError(
        `The ${kind} event was rejected: ${written.message}. Fix the ledger, then rerun orchestrate tick --loop.`,
      );
    }
  };
  const args = [
    join(root, HARNESS),
    "orchestrate",
    "tick",
    ...(idea === undefined ? [] : ["--idea", idea]),
  ];
  const loop = new TickLoop({
    flagOn: () => tickFlagOn(deps.fs, root),
    heartbeat: () => beat(TICK_STARTED),
    stopped: () => beat(TICK_STOPPED),
    pass: () => deps.runner.run(process.execPath, args, { cwd: root }),
    report: (result) => {
      deps.stdout(result.stdout);
      if (result.code !== 0) {
        deps.stderr(
          `${result.stderr}A pass ended with exit ${result.code}; the loop runs the next pass.\n`,
        );
      }
    },
    sleep: (ms) => deps.clock.sleep(ms),
  });
  const result = await loop.run();
  if (result.status === "flag-off") {
    deps.stdout(
      result.passes === 0
        ? FLAG_OFF
        : `The orchestrator-tick flag turned off after ${result.passes} passes, so the loop stopped.\n`,
    );
  }
  return 0;
}
