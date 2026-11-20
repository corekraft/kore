import type { BoundName, PassBounds, PassGate } from "./tick-bounds.js";

/**
 * The pane starts one pass may make. A hold stops them all; saver mode lets one
 * through. Each start the pass holds is recorded as a bound hit before it is skipped.
 */
export class Starts {
  private started = 0;

  constructor(
    private readonly bounds: PassBounds,
    private readonly gate: PassGate,
  ) {}

  /** The bound that holds a start for this issue now, recorded first; undefined when it may go ahead. */
  async held(issue: number): Promise<BoundName | undefined> {
    const bound: BoundName | undefined =
      this.bounds.hold ??
      (this.bounds.saver && this.started >= 1 ? "saver" : undefined);
    if (bound !== undefined) {
      await this.gate.record(issue, bound);
    }
    return bound;
  }

  /** Records a bound this pass hit for the issue, for a hold the host reads cannot see. */
  record(issue: number, bound: BoundName): Promise<void> {
    return this.gate.record(issue, bound);
  }

  /** Counts a start that went ahead, so saver mode lets no second one through. */
  taken(): void {
    this.started += 1;
  }

  /** Admits one start: the bound that holds it, recorded first, or undefined when it goes ahead and is counted. */
  async admit(issue: number): Promise<BoundName | undefined> {
    const bound = await this.held(issue);
    if (bound === undefined) {
      this.taken();
    }
    return bound;
  }
}
