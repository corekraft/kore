import type { RunResult, RunStatus } from "./idea-run.js";
import type { StepName, Tick } from "./tick.js";

/** How long `orchestrate run` waits between passes while a pane works; a placeholder (idea 0007). */
export const TICK_POLL_MS = 30 * 1000;

/** Passes one run may take before it gives up, so a stuck pane cannot hold it forever. */
export const MAX_TICK_PASSES = 2880;

/** The steps at which a run over one idea ends, and the status each reports. */
const ENDS: Partial<Record<StepName, RunStatus>> = {
  "record-outcome": "outcome-recorded",
  "awaiting-outcome": "awaiting-outcome",
  blocked: "blocked",
  "needs-judgment": "blocked",
  "needs-info": "blocked",
  "work-planned": "blocked",
  "awaiting-judge": "blocked",
  "not-queued": "not-queued",
};

/**
 * `orchestrate run` under the tick: passes scoped to one idea, one step each,
 * until the idea reaches an end. It sleeps only while a pane is working or a host bound holds it.
 */
export async function runTicks(
  tick: Pick<Tick, "pass">,
  idea: string,
  sleep: (ms: number) => Promise<void>,
  maxPasses: number = MAX_TICK_PASSES,
): Promise<RunResult> {
  for (let rounds = 1; rounds <= maxPasses; rounds++) {
    const [taken] = await tick.pass(idea);
    const status = taken === undefined ? undefined : ENDS[taken.step];
    if (status !== undefined) {
      return { status, rounds };
    }
    // A held pass waits as a working pane does: the host bound may clear on a later pass.
    if (taken?.step === "waiting" || taken?.step === "held") {
      await sleep(TICK_POLL_MS);
    }
  }
  return { status: "gave-up", rounds: maxPasses };
}
