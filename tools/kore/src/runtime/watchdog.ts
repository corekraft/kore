export type Signal = "SIGTERM" | "SIGKILL";

export interface WatchdogOptions {
  timeoutMs: number;
  graceMs: number;
  /** Delivers a signal to the child, or to its whole process group. */
  send: (signal: Signal) => void;
  /** Called once the timeout has fired, the child has exited, and the grace period is over. */
  settled: () => void;
}

/**
 * The SIGTERM-then-SIGKILL clock for one child. At the timeout it sends
 * SIGTERM; at the end of the grace period it sends SIGKILL to sweep anything
 * left (a grandchild holding the output pipes), and reports `escalated` only
 * when the child itself had not exited by then. It settles on the child's
 * exit plus the grace period, never on pipe close. A zero `timeoutMs` never
 * fires.
 */
export class Watchdog {
  private expired = false;
  private exited = false;
  private graceOver = false;
  private killedChild = false;
  private timer: NodeJS.Timeout | undefined;
  private graceTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: WatchdogOptions) {
    if (options.timeoutMs > 0) {
      this.timer = setTimeout(() => this.expire(), options.timeoutMs);
    }
  }

  get timeoutMs(): number {
    return this.options.timeoutMs;
  }
  timedOut(): boolean {
    return this.expired;
  }
  /** True when the child had not exited by the end of the grace period. */
  escalated(): boolean {
    return this.killedChild;
  }

  noteExit(): void {
    this.exited = true;
    this.settleIfDone();
  }

  /** Stops the clocks; call when the child finished without timing out. */
  clear(): void {
    clearTimeout(this.timer);
    if (!this.expired) {
      clearTimeout(this.graceTimer);
    }
  }

  private expire(): void {
    this.expired = true;
    this.options.send("SIGTERM");
    this.graceTimer = setTimeout(() => {
      this.graceOver = true;
      this.killedChild = !this.exited;
      this.options.send("SIGKILL");
      this.settleIfDone();
    }, this.options.graceMs);
  }

  private settleIfDone(): void {
    if (this.expired && this.exited && this.graceOver) {
      this.options.settled();
    }
  }
}
