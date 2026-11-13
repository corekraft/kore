import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommandError, ProcessRunner } from "./index.js";
import { CommandTimeoutError, type ProcessRunnerOptions } from "./runner.js";

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = null;
  kills: string[] = [];
  kill(signal: string): boolean {
    this.kills.push(signal);
    return true;
  }
  exit(code: number | null, signal: string | null = null): void {
    this.emit("exit", code, signal);
  }
  close(code: number | null): void {
    this.emit("close", code);
  }
}

function fake(options: ProcessRunnerOptions = {}) {
  const child = new FakeChild();
  const groupSignals: string[] = [];
  const runner = new ProcessRunner({
    spawn: (() => child) as never,
    signalGroup: (_pid, signal) => void groupSignals.push(signal),
    killGraceMs: 1000,
    ...options,
  });
  return { child, groupSignals, runner };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("SIGTERM goes to the process group at the timeout, not before", async () => {
  const { child, groupSignals, runner } = fake();
  const outcome = runner
    .run("tool", ["go"], { timeoutMs: 100 })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(99);
  expect(groupSignals).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(groupSignals).toEqual(["SIGTERM"]);
  child.exit(null, "SIGTERM");
  await vi.advanceTimersByTimeAsync(1000);
  const error = await outcome;
  assert.ok(error instanceof CommandTimeoutError);
  assert.ok(error instanceof CommandError);
  expect(error.message).toMatch(/tool go timed out after 100ms/);
  expect(error.message).toMatch(/stopped on SIGTERM/);
  expect(error.message).not.toMatch(/ignored|did not exit/);
});

test("a process that ignores SIGTERM gets SIGKILL after the grace period and is reported as such", async () => {
  const { child, groupSignals, runner } = fake();
  const outcome = runner
    .run("tool", ["go"], { timeoutMs: 100 })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(999);
  expect(groupSignals).toEqual(["SIGTERM"]);
  await vi.advanceTimersByTimeAsync(1);
  expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
  child.exit(null, "SIGKILL");
  const error = await outcome;
  assert.ok(error instanceof CommandTimeoutError);
  expect(error.escalatedToKill).toBe(true);
  expect(error.message).toMatch(/did not exit on SIGTERM.*SIGKILL/);
});

test("the run settles on exit plus the grace period even when a grandchild keeps the pipes open", async () => {
  const { child, groupSignals, runner } = fake();
  const outcome = runner
    .run("tool", ["go"], { timeoutMs: 100 })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  child.exit(null, "SIGTERM"); // 'close' never fires: a grandchild holds stdout
  await vi.advanceTimersByTimeAsync(1000);
  const error = await outcome;
  assert.ok(error instanceof CommandTimeoutError);
  expect(error.escalatedToKill).toBe(false);
  // The group is still swept at the end of the grace period.
  expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("a process that finishes in time is never signalled", async () => {
  const { child, groupSignals, runner } = fake();
  const outcome = runner.run("echo", ["ok"], { timeoutMs: 100 });
  child.stdout.write("ok\n");
  child.exit(0);
  child.close(0);
  expect((await outcome).stdout).toBe("ok\n");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(groupSignals).toEqual([]);
});

test("the constructor default applies, and a zero timeout disables it for one call", async () => {
  const first = fake({ defaultTimeoutMs: 100 });
  const hung = first.runner.run("x", []).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(first.groupSignals).toEqual(["SIGTERM"]);
  first.child.exit(null, "SIGTERM");
  await vi.advanceTimersByTimeAsync(1000);
  assert.ok((await hung) instanceof CommandTimeoutError);

  const second = fake({ defaultTimeoutMs: 100 });
  const unlimited = second.runner.run("x", [], { timeoutMs: 0 });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(second.groupSignals).toEqual([]);
  second.child.exit(0);
  second.child.close(0);
  await unlimited;
});

test("a child that shares the terminal is signalled directly, not as a group", async () => {
  const { child, groupSignals, runner } = fake();
  const outcome = runner
    .run("tool", ["go"], { timeoutMs: 100, stdin: "inherit" })
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(100);
  expect(child.kills).toEqual(["SIGTERM"]);
  expect(groupSignals).toEqual([]);
  child.exit(null, "SIGTERM");
  await vi.advanceTimersByTimeAsync(1000);
  await outcome;
});

test("a hung process with a grandchild is killed with its whole group (real processes)", async () => {
  vi.useRealTimers();
  const marker = "30.7351";
  const error = await new ProcessRunner({ killGraceMs: 200 })
    .run("bash", ["-c", `sleep ${marker} & wait`], { timeoutMs: 200 })
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof CommandTimeoutError);
  // A killed process can still show as a zombie for a moment: poll briefly.
  const gone = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (spawnSync("pgrep", ["-f", `sleep ${marker}`]).status === 1) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  };
  expect(await gone()).toBe(true);
});
