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
  hostLeaseRefusal,
  signedMainSendsOn,
  spawnLoadRefusal,
} from "../session/index.js";
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
): Promise<{ tick: Tick; lease: TickLease; cli: TickCli }> {
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
  const notifier = new TickNotifier(
    {
      attendedPane: (idea) => cli.attendedPane(idea),
      sent: (idea, state) => notices.sent(idea, state),
      openQuestions: (idea) => notices.openQuestions(idea),
      send: async (pane, body) =>
        deliver(deps, pane, body, {
          rejoinWrapped: await signedMainSendsOn(deps),
        }),
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
  return {
    tick: liveProofs === undefined ? tick : tick.withLiveProofs(liveProofs),
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

export const tickCommand: Command = {
  summary:
    "behind the local orchestrator-tick flag (off): one idempotent pass over the queue that advances each approved idea by at most one step, then exits, and calls no model; per idea it starts the writer, closes a finished pane, runs `review run`, runs the precheck and sends a failing change back, starts the judge, relaunches the writer after a send-back on the tier's model, and records the outcome only when the idea's `orchestrate run` was given one; a pane is named for its idea and PR head, so a rerun starts nothing twice; a third send-back starts a judgment pane (ADR 0121) that decides once; a work plan is persisted once through `orchestrate plan` (ADR 0121), then its pieces start one at a time from the persisted plan, each after the pieces it waits for, in a pane named for the piece, a writer in its own worktree, and a piece that ends blocked stops the plan for the owner; a refused plan, or one whose piece pane name spawn would refuse, is retried once and then the idea is labelled needs-info, and a later third send-back is reported as needs-judgment with nothing started; once an idea reaches blocked, needs-judgment or needs-info, the attended pane (the one its sessions were spawned from) gets one signed line naming the idea and the reason, recorded as a session.send event so it is sent once per idea and state; an owner-routed reserved question open on an idea (#1058) gets the same kind of line on any pass, once per question, recorded as a reserved session.send and never repeated after a later pass or a restart, with its question and reply read from the ledger (decision.routed, owner.replied) and never from the issue; with the tick-ticket-queue flag on too (off by default), a plain ready-for-agent ticket in the queue goes through the same steps as an idea, its writer brief naming the issue number and title and telling it to read the issue and follow writer.md, its panes named idea-ticket-<issue>-..., keyed on the PR head so a rerun starts nothing twice, under the same power, load and live-run bounds; a ticket labelled live-proof is skipped by those steps and goes to the live-proof path instead, and a ticket records no outcome after the judge merges, and a third send-back reports needs-judgment with nothing started; a ticket whose PR has merged gets one comment on the issue, signed with the sender line, saying it waits on a live proof or an owner step, recorded as a ticket.waiting event per merged PR so a rerun posts nothing twice (#1431); with the behind-main-notice flag on too (off by default; detection runs only when both flags are on), each idea with an open pull request is checked once per pass: a PR that conflicts with main (DIRTY), or is ready to merge but behind main (BEHIND, with CI green and no judge precheck failure), gets one branch update notice through `session send` to its live writer pane, recorded as a session.send event keyed by PR head and main head so a restart sends nothing twice (a changed main head sends again); the notice tells the writer to merge origin/main, never rebase or force-push, and to reply with exactly `pinned: no change` as its RESULT line when a live proof is pinned to its head; a PR whose writer pane is not live, or whose merge state, CI or main head cannot be read, is reported and never messaged; the tick never pushes, updates or merges a branch; reads power (pmset on macOS, /sys/class/power_supply on Linux, where a host with no battery counts as on mains), the load ceiling (KORE_SPAWN_MAX_LOAD) and a live run's host lease before it starts anything: on battery or unreadable power one pane starts per pass, above the ceiling or under a live run's lease no pane starts, and each start held that way is recorded as a tick.bound ledger event and reported as held; runs under a per-machine lease in the host lock directory that the next tick recovers once it is 30 minutes old, and a held lease skips the pass; with the flag off it does nothing and exits 0 (--idea to scope the pass to one idea); --loop runs passes in a loop, each as a child process so a failing pass ends only itself, writing tick.started before each pass and tick.stopped when it ends, until the flag is turned off (status reports a gap when the heartbeat stops); --install writes the owner's launchd restart job behind the flag and starts nothing, the owner loads it; with the local tick-ticket-queue flag on, the pass takes the items in the frontier's order (`harness queue next`); with the tick-live-proofs flag on too (off by default; it needs tick-ticket-queue), the first queued ticket labelled live-proof that has no pane yet gets one live-proof-<issue> pane, a Sonnet writer in a worktree briefed to take the host lease, run the proof the issue names and record it through a verification outcome and an issue comment, never activating a flag, dispatching live.yml or the nightly, or reaching kore-vps; at most one live-proof pane runs at a time on the host, a live-run lease hold or a running live-proof pane starts none, and that start is recorded as a tick.bound event and reported as held (by live-run or live-proof); a finished live-proof pane is closed, and a ticket whose live-proof pane already ran is reported blocked and never started twice; with --loop and the local tick-self-update flag on (off by default), each pass is first preceded by a pull of a clean main that is a fast-forward of origin/main and a rebuild of the harness bundle, and a refusal or failed build is reported while the old bundle keeps running",
  options: { idea: "string", loop: "boolean", install: "boolean" },
  run: runTick,
};
