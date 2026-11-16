import { hostname } from "node:os";
import { join } from "node:path";
import {
  FileLeaseStore,
  HarnessCliError,
  TICK_LEASE_MAX_AGE_MS,
  Tick,
  TickCli,
  TickLease,
  leasedPass,
  runTicks,
  tickFlagOn,
  type IdeaStep,
  type Measured,
  type RunResult,
} from "../orchestrator/index.js";
import {
  hostLocksDirectory,
  mainRoot,
  type CliDeps,
  type Command,
  type CommandContext,
} from "../runtime/index.js";

const FAILED = 1;
const LEASE_FILE = "orchestrate-tick.lock";
const SESSIONS = ".kore/state/sessions";

/** The tick, the lease it runs under and the tools it drives, wired to the machine's real files. */
async function build(
  deps: CliDeps,
  root: string,
  outcomes: ReadonlyMap<string, Measured>,
): Promise<{ tick: Tick; lease: TickLease; cli: TickCli }> {
  const main = (await mainRoot(deps)) ?? root;
  const cli = new TickCli(deps.runner, root, deps.fs, join(main, SESSIONS));
  const lease = new TickLease(
    new FileLeaseStore(deps.fs, join(hostLocksDirectory(deps.env), LEASE_FILE)),
    () => deps.clock.now(),
    deps.ids.next(),
    { pid: process.pid, host: hostname() },
    TICK_LEASE_MAX_AGE_MS,
  );
  return { tick: new Tick(cli, outcomes), lease, cli };
}

const said = (step: IdeaStep) =>
  `Idea ${step.idea}: ${step.step}${step.pane === undefined ? "" : ` (${step.pane})`}.\n`;

async function runTick(context: CommandContext): Promise<number> {
  const { deps, json, options } = context;
  const idea =
    typeof options["idea"] === "string" ? options["idea"] : undefined;
  try {
    const root = await deps.root();
    if (!(await tickFlagOn(deps.fs, root))) {
      deps.stdout(
        json
          ? `${JSON.stringify({ flag: "off", steps: [] })}\n`
          : "The orchestrator-tick flag is off in the local overlay, so no idea was advanced.\n",
      );
      return 0;
    }
    const { tick, lease } = await build(deps, root, new Map());
    const pass = await leasedPass(lease, tick, idea);
    if (pass.status === "held") {
      const { holder } = pass;
      deps.stdout(
        json
          ? `${JSON.stringify({ held: true, ...(holder === undefined ? {} : { holder }) })}\n`
          : `Another tick holds the lease${holder === undefined ? "" : ` (pid ${holder.pid} on ${holder.host}, since ${holder.acquiredAt})`}; this pass advanced nothing.\n`,
      );
      return 0;
    }
    if (json) {
      deps.stdout(`${JSON.stringify({ steps: pass.steps })}\n`);
      return 0;
    }
    if (pass.recovered !== undefined) {
      deps.stdout(
        `Recovered a tick lease held since ${pass.recovered.acquiredAt} by pid ${pass.recovered.pid}.\n`,
      );
    }
    deps.stdout(
      pass.steps.length === 0
        ? "No approved idea is in flight.\n"
        : pass.steps.map(said).join(""),
    );
    return 0;
  } catch (error) {
    if (!(error instanceof HarnessCliError)) {
      throw error;
    }
    deps.stderr(`${error.message}\n`);
    return FAILED;
  }
}

/**
 * `orchestrate run` with the tick flag on: passes scoped to one idea, each under
 * the lease, until the idea ends. A pass that finds the lease held counts as waiting.
 */
export async function runOnTicks(
  deps: CliDeps,
  root: string,
  idea: string,
  outcome: Measured | undefined,
): Promise<RunResult> {
  const { tick, lease } = await build(
    deps,
    root,
    outcome === undefined ? new Map() : new Map([[idea, outcome]]),
  );
  return runTicks(
    {
      pass: async (only) => {
        const pass = await leasedPass(lease, tick, only);
        return pass.status === "ran"
          ? pass.steps
          : [{ idea: only ?? idea, step: "waiting" }];
      },
    },
    idea,
    (ms) => deps.clock.sleep(ms),
  );
}

export const tickCommand: Command = {
  summary:
    "behind the local orchestrator-tick flag (off): one idempotent pass over the queue that advances each approved idea by at most one step, then exits, and calls no model; per idea it starts the writer, closes a finished pane, runs `review run`, runs the precheck and sends a failing change back, starts the judge, relaunches the writer after a send-back on the tier's model, and records the outcome only when the idea's `orchestrate run` was given one; a pane is named for its idea and PR head, so a rerun starts nothing twice; a third send-back is reported as needs-judgment and nothing is started; runs under a per-machine lease in the host lock directory that the next tick recovers once it is 30 minutes old, and a held lease skips the pass; with the flag off it does nothing and exits 0 (--idea to scope the pass to one idea)",
  options: { idea: "string" },
  run: runTick,
};
