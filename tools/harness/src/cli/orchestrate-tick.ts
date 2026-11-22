// oxlint-disable import/max-dependencies -- the tick entry point wires every tick port, herdr and hc alike
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import {
  BOUND_LABELS,
  BranchLedger,
  BranchNotice,
  BranchStepNotifier,
  FileLeaseStore,
  HarnessCliError,
  LiveProofs,
  NotifyLedger,
  PLANS_DIRECTORY,
  TICK_COMMAND,
  TICK_ENV,
  TICK_LEASE_MAX_AGE_MS,
  Tick,
  TickBounds,
  TickCli,
  TickLease,
  TickNotifier,
  WaitingLedger,
  WaitingStepNotifier,
  WaitingTicketNotice,
  branchNoticeFlagOn,
  leasedPass,
  liveProofsOn,
  reconcilingPass,
  runTicks,
  tickFlagOn,
  type IdeaStep,
  type Measured,
  type PassGate,
  type RunResult,
} from "../orchestrator/index.js";
import {
  hostLocksDirectory,
  mainRoot,
  readPower,
  type CliDeps,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import {
  deliver,
  hcSessionsOn,
  hostLeaseRefusal,
  signedMainSendsOn,
  spawnLoadRefusal,
} from "../session/index.js";
import { hcAttended, hcReconcile } from "./orchestrate-tick-hc.js";
import { installTickJob } from "./orchestrate-tick-install.js";
import { runTickLoop } from "./orchestrate-tick-loop.js";

const FAILED = 1;
const LEASE_FILE = "orchestrate-tick.lock";
const SESSIONS = ".kore/state/sessions";

/**
 * The host bounds each pass reads (power, the load ceiling and a live run's lease),
 * and the main checkout's ledger each bound hit is written to as a tick.bound event.
 */
function boundGate(deps: CliDeps, main: string): PassGate {
  const bounds = new TickBounds({
    power: () => readPower(deps.runner, process.platform, deps.fs),
    overLoad: () => spawnLoadRefusal(deps) !== undefined,
    leaseHeld: async () => (await hostLeaseRefusal(deps)) !== undefined,
  });
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    resolve(main, DEFAULT_LEDGER),
  );
  return {
    read: () => bounds.read(),
    record: async (issue, bound) => {
      const written = await ledger.record({
        source: "claude",
        kind: "tick.bound",
        occurredAt: deps.clock.now().toISOString(),
        idea: `#${issue}`,
        label: BOUND_LABELS[bound],
      });
      if (!written.ok) {
        throw new HarnessCliError(
          `The tick.bound event was rejected: ${written.message}. Fix the ledger, then rerun orchestrate tick.`,
        );
      }
    },
  };
}

/** The tick, the lease it runs under and the tools it drives, wired to the machine's real files. */
async function build(
  deps: CliDeps,
  root: string,
  outcomes: ReadonlyMap<string, Measured>,
): Promise<{ tick: Pick<Tick, "pass">; lease: TickLease; cli: TickCli }> {
  const main = (await mainRoot(deps)) ?? root;
  const cli = new TickCli(
    deps.runner,
    root,
    deps.fs,
    join(main, SESSIONS),
    join(main, PLANS_DIRECTORY),
  );
  const lease = new TickLease(
    new FileLeaseStore(deps.fs, join(hostLocksDirectory(deps.env), LEASE_FILE)),
    () => deps.clock.now(),
    deps.ids.next(),
    { pid: process.pid, host: hostname() },
    TICK_LEASE_MAX_AGE_MS,
  );
  const notices = new NotifyLedger(
    new Ledger(deps.fs, deps.clock, deps.ids, resolve(main, DEFAULT_LEDGER)),
    () => deps.clock.now().toISOString(),
  );
  // With hc-sessions on, the notice goes to the one attended agent terminal and the pass reconciles first (plan 16, Step 4).
  const hc = await hcSessionsOn(deps);
  const herdr = {
    attendedPane: (idea: string) => cli.attendedPane(idea),
    send: async (pane: string, body: string) =>
      deliver(deps, pane, body, {
        rejoinWrapped: await signedMainSendsOn(deps),
      }),
  };
  const notifier = new TickNotifier(
    {
      ...(hc ? hcAttended(deps) : herdr),
      sent: (idea, state) => notices.sent(idea, state),
      openQuestions: (idea) => notices.openQuestions(idea),
      record: (event) => notices.record(event),
    },
    TICK_ENV,
    TICK_COMMAND,
  );
  // The branch update notice runs only behind its own flag, beside orchestrator-tick (#980).
  const told = (await branchNoticeFlagOn(deps.fs, root))
    ? new BranchStepNotifier(notifier, branchNotice(deps, cli, main))
    : notifier;
  // Live proofs run only behind tick-live-proofs and tick-ticket-queue, one pane at a time.
  const liveProofs = (await liveProofsOn(deps.fs, root))
    ? new LiveProofs({
        panes: () => cli.livePanes(),
        spawn: (launch) => cli.spawn(launch),
        close: (name) => cli.close(name),
      })
    : undefined;
  // A ticket whose PR has merged gets its waiting comment beside the other notices, with the ticket queue (#1431).
  const waiting = new WaitingStepNotifier(told, waitingNotice(deps, cli, main));
  const tick = new Tick(
    cli,
    outcomes,
    boundGate(deps, main),
    undefined,
    waiting,
  );
  const ticking =
    liveProofs === undefined ? tick : tick.withLiveProofs(liveProofs);
  return {
    tick: hc
      ? reconcilingPass(await hcReconcile(deps, main), ticking)
      : ticking,
    lease,
    cli,
  };
}

/** The branch update notice, wired to the PR reads, the dedupe record and `session send` (#980). */
function branchNotice(deps: CliDeps, cli: TickCli, main: string): BranchNotice {
  const ledger = new BranchLedger(
    new Ledger(deps.fs, deps.clock, deps.ids, resolve(main, DEFAULT_LEDGER)),
    () => deps.clock.now().toISOString(),
  );
  const base = Object.fromEntries(
    Object.entries(deps.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return new BranchNotice({
    delivery: (issue) => cli.delivery(issue),
    panes: (idea) => cli.panes(idea),
    mergeState: (pr) => cli.mergeState(pr),
    ciGreen: (pr) => cli.ciGreen(pr),
    precheckFailing: async (pr) => (await cli.precheck(pr)).sendBack,
    head: (pr) => cli.head(pr),
    mainHead: () => cli.mainHead(),
    sent: (idea, key) => ledger.sent(idea, key),
    send: (writer, body) => cli.sendToWriter(writer, body, base),
    record: (event) => ledger.record(event),
  });
}

/** The waiting comment on a ticket whose PR has merged, wired to the issue comment, the dedupe record and the ledger (#1431). */
function waitingNotice(
  deps: CliDeps,
  cli: TickCli,
  main: string,
): WaitingTicketNotice {
  const ledger = new WaitingLedger(
    new Ledger(deps.fs, deps.clock, deps.ids, resolve(main, DEFAULT_LEDGER)),
    () => deps.clock.now().toISOString(),
  );
  return new WaitingTicketNotice({
    sent: (idea, key) => ledger.sent(idea, key),
    comment: (issue, body) => cli.commentIssue(issue, body),
    record: (event) => ledger.record(event),
  });
}

const said = (step: IdeaStep) =>
  `Idea ${step.idea}: ${step.step}${step.pane === undefined ? "" : ` (${step.pane})`}${step.bound === undefined ? "" : ` by ${step.bound}`}.\n${step.notice === undefined ? "" : `${step.notice}\n`}`;

/** One pass over the queue: the mode `orchestrate tick` runs when it is given neither --loop nor --install. */
async function runPass(
  context: CommandContext,
  root: string,
  idea: string | undefined,
): Promise<number> {
  const { deps, json } = context;
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
}

async function runTick(context: CommandContext): Promise<number> {
  const { deps, options } = context;
  const idea =
    typeof options["idea"] === "string" ? options["idea"] : undefined;
  try {
    const root = await deps.root();
    if (options["install"] === true) {
      return await installTickJob(deps, root);
    }
    if (options["loop"] === true) {
      return await runTickLoop(deps, root, idea);
    }
    return await runPass(context, root, idea);
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

export const tickCommand = {
  summary:
    "Advances each approved idea one step per pass, behind the orchestrator-tick flag.",
  options: { idea: "string", loop: "boolean", install: "boolean" },
  run: runTick,
} satisfies Omit<Command, "help">;
