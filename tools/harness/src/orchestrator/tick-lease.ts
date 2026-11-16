/** How long a tick lease stands before another tick may recover it; a placeholder the owner may tune (idea 0007). */
export const TICK_LEASE_MAX_AGE_MS = 30 * 60 * 1000;

/** What a tick writes to the lease file: who holds it and since when. */
export interface LeaseRecord {
  token: string;
  pid: number;
  host: string;
  acquiredAt: string;
}

/** The lease file, one per machine; faked in specs. */
export interface LeaseStore {
  read(): Promise<LeaseRecord | undefined>;
  /** Writes the file only when it does not exist; false when it does. */
  create(record: LeaseRecord): Promise<boolean>;
  overwrite(record: LeaseRecord): Promise<void>;
  remove(): Promise<void>;
}

export type LeaseResult =
  | { status: "acquired" }
  | { status: "recovered"; from: LeaseRecord }
  | { status: "held"; holder?: LeaseRecord };

/**
 * The per-machine lease that keeps two ticks from running at once. A lease
 * that has stood for the age limit is recovered by the next tick, so a dead
 * tick never holds it forever.
 */
export class TickLease {
  constructor(
    private readonly store: LeaseStore,
    private readonly now: () => Date,
    private readonly token: string,
    private readonly owner: { pid: number; host: string },
    private readonly maxAgeMs: number = TICK_LEASE_MAX_AGE_MS,
  ) {}

  async acquire(): Promise<LeaseResult> {
    const mine = this.record();
    if (await this.store.create(mine)) {
      return { status: "acquired" };
    }
    const holder = await this.store.read();
    if (holder === undefined) {
      return { status: "held" };
    }
    const age = this.now().getTime() - Date.parse(holder.acquiredAt);
    if (age < this.maxAgeMs) {
      return { status: "held", holder };
    }
    await this.store.overwrite(mine);
    // Two ticks may recover the same lease; the one whose token survived runs.
    const winner = await this.store.read();
    return winner?.token === this.token
      ? { status: "recovered", from: holder }
      : { status: "held", ...(winner === undefined ? {} : { holder: winner }) };
  }

  /** Removes the lease only while it still carries this tick's token. */
  async release(): Promise<void> {
    if ((await this.store.read())?.token === this.token) {
      await this.store.remove();
    }
  }

  private record(): LeaseRecord {
    return {
      token: this.token,
      pid: this.owner.pid,
      host: this.owner.host,
      acquiredAt: this.now().toISOString(),
    };
  }
}
