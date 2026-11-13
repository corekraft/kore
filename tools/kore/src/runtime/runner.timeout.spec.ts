import assert from "node:assert/strict";
import { test } from "vitest";
import { CommandError, ProcessRunner } from "./index.js";
import { CommandTimeoutError } from "./runner.js";

test("a hung process is killed at the timeout and the error names the cause", async () => {
  const started = Date.now();
  const error = await new ProcessRunner()
    .run("sleep", ["30"], { timeoutMs: 100 })
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof CommandTimeoutError);
  assert.ok(error instanceof CommandError);
  assert.match(error.message, /timed out after 100ms/);
  assert.match(error.message, /sleep 30/);
  assert.ok(Date.now() - started < 10000);
});

test("a process that ignores SIGTERM is escalated to SIGKILL", async () => {
  const started = Date.now();
  const error = await new ProcessRunner({ killGraceMs: 100 })
    .run("bash", ["-c", "trap '' TERM; while true; do sleep 1; done"], {
      timeoutMs: 100,
    })
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof CommandTimeoutError);
  assert.match(error.message, /SIGKILL/);
  assert.ok(Date.now() - started < 10000);
});

test("the constructor default applies when a call sets no timeout", async () => {
  const error = await new ProcessRunner({ defaultTimeoutMs: 100 })
    .run("sleep", ["30"])
    .catch((caught: unknown) => caught);
  assert.ok(error instanceof CommandTimeoutError);
});

test("a zero timeout disables the default for one call", async () => {
  const result = await new ProcessRunner({ defaultTimeoutMs: 50 }).run(
    "bash",
    ["-c", "sleep 0.3; echo done"],
    { timeoutMs: 0 },
  );
  assert.equal(result.stdout.trim(), "done");
});

test("a process that finishes in time is not reported as timed out", async () => {
  const result = await new ProcessRunner().run("echo", ["ok"], {
    timeoutMs: 5000,
  });
  assert.equal(result.stdout.trim(), "ok");
});
