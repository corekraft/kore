import type { Power } from "../runtime/index.js";

/** A bound that holds every new pane start in a pass: the host load, or a live run's lease. */
export type HoldName = "load" | "live-run";

/** A bound a pass hit, as the tick.bound ledger event names it. */
export type BoundName = HoldName | "saver";

/** What the host allows this pass: saver mode on battery, and a hold that stops every start. */
export interface PassBounds {
  /** On battery: at most one pane starts per pass. */
  saver: boolean;
  /** When set, no pane starts this pass. */
  hold?: HoldName;
}

/** The host reads the tick needs, each through an interface so specs never read the real host. */
export interface BoundReaders {
  power(): Promise<Power>;
  /** True when the host load is above KORE_SPAWN_MAX_LOAD, or cannot be read under that ceiling. */
  overLoad(): boolean;
  /** True when a live run holds the host lease, or the lease cannot be judged. */
  leaseHeld(): Promise<boolean>;
}

/** The pass's bounds, read once per pass, and the ledger event each bound hit writes. */
export interface PassGate {
  read(): Promise<PassBounds>;
  record(issue: number, bound: BoundName): Promise<void>;
}

/** The label a tick.bound event carries: 1 to 100 characters, no control characters. */
export const BOUND_LABELS: Record<BoundName, string> = {
  saver: "on battery: one pane starts per pass",
  load: "host load above KORE_SPAWN_MAX_LOAD, or unreadable",
  "live-run": "a live run holds the host lease, or it cannot be judged",
};

/** Reads the host through its readers into one pass's bounds. */
export class TickBounds {
  constructor(private readonly readers: BoundReaders) {}

  async read(): Promise<PassBounds> {
    const power = await this.readers.power();
    return { saver: power !== "ac", ...(await this.hold()) };
  }

  /** The first hold that applies: the load ceiling, then a live run's lease. */
  private async hold(): Promise<{ hold?: HoldName }> {
    if (this.readers.overLoad()) {
      return { hold: "load" };
    }
    return (await this.readers.leaseHeld()) ? { hold: "live-run" } : {};
  }
}

/** The gate of a tick that is given none: every pane may start, and nothing is recorded. */
export const OPEN_GATE: PassGate = {
  read: async () => ({ saver: false }),
  record: async () => undefined,
};
