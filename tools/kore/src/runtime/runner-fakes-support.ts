// Fakes shared by the runner's unit specs: a child process that emits what a test
// tells it to, and a watchdog whose clock a test drives by hand. Not a unit.

import { EventEmitter } from "node:events";
import { vi, type Mock } from "vitest";
import type { Signal } from "./watchdog.js";

export interface WatchdogSettings {
  timeoutMs: number;
  graceMs: number;
  send: (signal: Signal) => void;
  settled: () => void;
}

/** Records the watchdog each run creates, so a test can expire it or settle it. */
export class FakeWatchdog {
  static readonly created: FakeWatchdog[] = [];
  expired = false;
  killed = false;
  exits = 0;
  clears = 0;

  constructor(readonly options: WatchdogSettings) {
    FakeWatchdog.created.push(this);
  }
  /** Forgets the watchdogs of earlier tests, so `lastWatchdog` finds this test's. */
  static reset(): void {
    FakeWatchdog.created.length = 0;
  }
  get timeoutMs(): number {
    return this.options.timeoutMs;
  }
  timedOut(): boolean {
    return this.expired;
  }
  escalated(): boolean {
    return this.killed;
  }
  noteExit(): void {
    this.exits += 1;
  }
  clear(): void {
    this.clears += 1;
  }
}

/** The watchdog created by the most recent run. */
export function lastWatchdog(): FakeWatchdog {
  const dog = FakeWatchdog.created.at(-1);
  if (dog === undefined) {
    throw new Error("no watchdog was created");
  }
  return dog;
}

/** A child process with the streams and signals the runner listens to. */
export class FakeChild extends EventEmitter {
  readonly pid: number = 4242;
  readonly stdout: EventEmitter & { destroy: Mock<() => void> } = Object.assign(
    new EventEmitter(),
    { destroy: vi.fn<() => void>() },
  );
  readonly stderr: EventEmitter & { destroy: Mock<() => void> } = Object.assign(
    new EventEmitter(),
    { destroy: vi.fn<() => void>() },
  );
  readonly stdin: { end: Mock<(input: string) => void> } = {
    end: vi.fn<(input: string) => void>(),
  };
  readonly kill: Mock<(signal: string) => void> =
    vi.fn<(signal: string) => void>();
}
