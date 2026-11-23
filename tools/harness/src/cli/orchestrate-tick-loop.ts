import { join, resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  HarnessCliError,
  TICK_SELF_UPDATE_FAILED,
  TICK_STARTED,
  TICK_STOPPED,
  TickLoop,
  TickSelfUpdate,
  tickFlagOn,
  tickSelfUpdateOn,
} from "../orchestrator/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { ensureLedgerWatch } from "./orchestrate-tick-watch.js";

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
  const updater = selfUpdater(deps, root, ledger);
  const args = [join(root, HARNESS), "orchestrate", "tick"];
  const loop = new TickLoop({
    flagOn: () => tickFlagOn(deps.fs, root),
    ensureWatch: () => ensureLedgerWatch(deps, main),
    update: async () => {
      if (await tickSelfUpdateOn(deps.fs, root)) {
        await updater.run();
      }
    },
    updateFailed: (error) => deps.stderr(describeUpdateFailure(error)), // rethrows an unexpected error
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

const UPDATE_KEEPS = "The tick keeps the bundle it has and runs the pass";

/** The caught update error's own message with the fix for its kind; only the expected kinds are handled, any other error is rethrown. */
function describeUpdateFailure(error: unknown): string {
  if (error instanceof HarnessCliError) {
    return `The self-update step could not write the ledger: ${error.message}\n${UPDATE_KEEPS}; fix the ledger file it names, then the next pass retries the update.\n`;
  }
  if (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ENOENT" &&
    String((error as NodeJS.ErrnoException).syscall).startsWith("spawn")
  ) {
    return `The self-update step could not start a tool: ${error.message}\n${UPDATE_KEEPS}; install git and mise on PATH (mise install), then the next pass retries the update.\n`;
  }
  throw error;
}

/** The step the loop runs before each pass: the tick-self-update flag gates it, and a failed build is recorded on the ledger. */
function selfUpdater(
  deps: CliDeps,
  root: string,
  ledger: Ledger,
): TickSelfUpdate {
  return new TickSelfUpdate({
    runner: deps.runner,
    root,
    recordFailure: async (label) => {
      const written = await ledger.record({
        source: "claude",
        kind: TICK_SELF_UPDATE_FAILED,
        occurredAt: deps.clock.now().toISOString(),
        label,
      });
      if (!written.ok) {
        deps.stderr(
          `The ${TICK_SELF_UPDATE_FAILED} event was rejected: ${written.message}\n`,
        );
      }
    },
    stdout: (text) => deps.stdout(text),
    stderr: (text) => deps.stderr(text),
  });
}
