import { pacingPlan } from "./ingress-pacing.js";

// Docs: infra/plans/13-agentgateway-ingress.md#measurement-method

/**
 * Paces the request load: with a target rate each batch gets a slot, and a
 * batch that finishes early sleeps out the rest of it. Without a target it
 * does nothing and never reads the clock, so the closed loop is unchanged.
 */
export class LoadPacer {
  readonly batchSize: number;
  private readonly plan?: { batchSize: number; batchSeconds: number };

  constructor(
    readonly target: number | undefined,
    requestsPerRoute: number,
    private readonly deps: {
      sleep: (seconds: number) => Promise<void>;
      now: () => number;
    },
  ) {
    if (target !== undefined) {
      this.plan = pacingPlan(target, requestsPerRoute);
    }
    this.batchSize = this.plan?.batchSize ?? requestsPerRoute;
  }

  /** The clock reading at the start of a batch; 0 when unpaced. */
  begin(): number {
    return this.plan === undefined ? 0 : this.deps.now();
  }

  /** Sleeps out the rest of the batch's slot; a slow batch gets none. */
  async end(began: number): Promise<void> {
    if (this.plan === undefined) {
      return;
    }
    const elapsed = (this.deps.now() - began) / 1000;
    const wait = Math.round((this.plan.batchSeconds - elapsed) * 1000) / 1000;
    if (wait > 0) {
      await this.deps.sleep(wait);
    }
  }
}
