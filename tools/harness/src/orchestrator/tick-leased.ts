import type { IdeaStep, Tick } from "./tick.js";
import type { LeaseRecord, TickLease } from "./tick-lease.js";

export type LeasedResult =
  | { status: "ran"; steps: IdeaStep[]; recovered?: LeaseRecord }
  | { status: "held"; holder?: LeaseRecord };

/** One pass under the per-machine lease: none runs while another tick holds it, and the lease is released however the pass ends. */
export async function leasedPass(
  lease: TickLease,
  tick: Pick<Tick, "pass">,
  only?: string,
): Promise<LeasedResult> {
  const acquired = await lease.acquire();
  if (acquired.status === "held") {
    return acquired.holder === undefined
      ? { status: "held" }
      : { status: "held", holder: acquired.holder };
  }
  try {
    const steps = await tick.pass(only);
    return acquired.status === "recovered"
      ? { status: "ran", steps, recovered: acquired.from }
      : { status: "ran", steps };
  } finally {
    await lease.release();
  }
}
