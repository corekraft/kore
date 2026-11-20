import type { RunResult } from "../runtime/index.js";

/** How long the loop waits between passes; a placeholder the owner may tune (idea 0007). */
export const TICK_LOOP_INTERVAL_MS = 60 * 1000;

/** The loop's ports: the flag, the heartbeat events, one child pass and its report, and the clock. */
export interface LoopPorts {
  /** Whether the local overlay still turns the tick on; read before every pass. */
  flagOn(): Promise<boolean>;
  /** Brings the checkout and bundle up to date before a pass; absent means the loop has no update step. */
  update?(): Promise<void>;
  /** Writes the heartbeat (tick.started) before a pass starts. */
  heartbeat(): Promise<void>;
  /** Writes tick.stopped once the loop has ended. */
  stopped(): Promise<void>;
  /** Runs one pass as a child process; a pass that throws resolves with a non-zero code. */
  pass(): Promise<RunResult>;
  /** Shows a finished pass to the person running the loop. */
  report(result: RunResult): void;
  sleep(ms: number): Promise<void>;
}

export type LoopResult =
  { status: "limit"; passes: number } | { status: "flag-off"; passes: number };

/**
 * `orchestrate tick --loop`: runs each pass as a child process, so a pass that
 * throws ends only that pass. It beats before each pass and writes its stop
 * event when it ends, and it ends when the flag is turned off.
 */
export class TickLoop {
  constructor(
    private readonly ports: LoopPorts,
    private readonly intervalMs: number = TICK_LOOP_INTERVAL_MS,
  ) {}

  async run(maxPasses: number = Number.POSITIVE_INFINITY): Promise<LoopResult> {
    let passes = 0;
    let started = false;
    try {
      while (passes < maxPasses) {
        if (!(await this.ports.flagOn())) {
          return { status: "flag-off", passes };
        }
        await this.ports.update?.();
        await this.ports.heartbeat();
        started = true;
        const result = await this.ports.pass();
        this.ports.report(result);
        passes += 1;
        if (passes < maxPasses) {
          await this.ports.sleep(this.intervalMs);
        }
      }
      return { status: "limit", passes };
    } finally {
      if (started) {
        await this.ports.stopped();
      }
    }
  }
}
