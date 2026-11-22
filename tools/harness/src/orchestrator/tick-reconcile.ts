import type { Terminal, TerminalError } from "../terminal/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { Tick } from "./tick.js";
import type { Unsettled } from "./tick-unsettled.js";

/** The reason a session whose terminal ended is recorded with (plan 16, Grilled Decisions 10). */
const LOST = "lost with its parent";

/** The ports the reconcile needs: the open hc sessions, hc's listing, the report check and the record write. */
export interface ReconcilePorts {
  /** The hc sessions that are open, have no result and name a terminal. */
  unsettled: () => Promise<Unsettled[]>;
  /** Every terminal hc lists, finished ones included (`hc ls --all`). */
  list: () => Promise<Terminal[] | TerminalError>;
  /** Whether an unread report from the session sits under `cwd`, the checkout its terminal ran in. */
  reported: (session: Unsettled, cwd: string) => Promise<boolean>;
  /** Records the session as blocked, with the reason as its result. */
  block: (name: string, reason: string) => Promise<void>;
}

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/** The reason a lost session is recorded with: its terminal finished, or hc no longer lists it. */
function reasonOf(terminal: string, listed: Terminal | undefined): string {
  return listed === undefined
    ? `${LOST}: terminal ${terminal} is gone`
    : `${LOST}: terminal ${terminal} has finished`;
}

/**
 * Records every open hc session whose terminal has finished or is gone as blocked, lost with its
 * parent, so the tick never respawns it and never removes its worktree. A session with an unread report
 * is not lost: its wait settles it as done or blocked. A live terminal, even one at status error, is not lost.
 */
export class TickReconcile {
  constructor(
    private readonly ports: ReconcilePorts,
    /** The main checkout, where a session with no worktree of its own left its report. */
    private readonly main: string,
  ) {}

  /** Reconciles the open sessions; returns the names it recorded as blocked. */
  async reconcile(): Promise<string[]> {
    const open = await this.ports.unsettled();
    if (open.length === 0) {
      return [];
    }
    const listed = await this.ports.list();
    if ("error" in listed) {
      throw new HarnessCliError(messageOf(listed));
    }
    const recorded: string[] = [];
    for (const session of open) {
      const terminal = listed.find((t) => t.id === session.terminal);
      if (terminal?.state === "live") {
        continue;
      }
      const cwd = terminal?.cwd ?? session.worktree ?? this.main;
      if (await this.ports.reported(session, cwd)) {
        continue;
      }
      await this.ports.block(
        session.name,
        reasonOf(session.terminal, terminal),
      );
      recorded.push(session.name);
    }
    return recorded;
  }
}

/**
 * A pass that reconciles first. When the reconcile fails the pass does not run, so no lost
 * session is acted on blind.
 */
export function reconcilingPass(
  reconcile: Pick<TickReconcile, "reconcile">,
  tick: Pick<Tick, "pass">,
): Pick<Tick, "pass"> {
  return {
    pass: async (only?: string) => {
      await reconcile.reconcile();
      return tick.pass(only);
    },
  };
}
