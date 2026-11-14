import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CommandError,
  ProcessRunner,
  withSignal,
} from "../../src/runtime/index.js";
import { RecordingRunner } from "../../src/runtime/runner.js";

test("aborting the signal terminates a running process promptly", async () => {
  const controller = new AbortController();
  const started = Date.now();
  const running = new ProcessRunner().run("sleep", ["30"], {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(running, CommandError);
  assert.ok(Date.now() - started < 10000);
});

test("a signal that is already aborted never leaves the process running", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new ProcessRunner().run("sleep", ["30"], { signal: controller.signal }),
    CommandError,
  );
});

test("withSignal hands the signal to every command and keeps other options", async () => {
  const inner = new RecordingRunner();
  const controller = new AbortController();
  const runner = withSignal(inner, controller.signal);
  await runner.run("helm", ["version"], { capture: true });
  assert.equal(inner.calls[0]!.options?.signal, controller.signal);
  assert.equal(inner.calls[0]!.options?.capture, true);
});
