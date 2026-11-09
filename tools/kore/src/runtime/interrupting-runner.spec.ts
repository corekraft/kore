import assert from "node:assert/strict";
import { test } from "vitest";
import { interruptingRunner } from "./interrupting-runner.js";
import { CommandError, type Runner, type RunOptions } from "./runner.js";

// Docs: docs/decisions/0079-live-interruption-specs.md
// The live interruption specs kill one real command mid-run. This is the
// offline proof of the runner that does the killing.

/** Runs until its signal aborts, as a long helm or cosign process would. */
class Hanging implements Runner {
  started: string[] = [];
  async run(
    command: string,
    args: readonly string[],
    options: RunOptions = {},
  ) {
    this.started.push(`${command} ${args[0] ?? ""}`.trim());
    if (args[0] !== "hang") {
      return { stdout: "ok", stderr: "", code: 0 };
    }
    return await new Promise<never>((_, reject) => {
      options.signal?.addEventListener("abort", () =>
        reject(
          new CommandError(command, args, {
            stdout: "",
            stderr: "terminated",
            code: 143,
          }),
        ),
      );
    });
  }
}

test("the first matching command is terminated after the delay and the interruption is recorded", async () => {
  const inner = new Hanging();
  const { runner, interrupted } = interruptingRunner(inner, {
    matches: (command, args) => command === "helm" && args[0] === "hang",
    afterMs: 5,
  });
  await assert.rejects(runner.run("helm", ["hang"]), CommandError);
  assert.equal(interrupted(), true);
});

test("commands that do not match run to completion and nothing is recorded", async () => {
  const inner = new Hanging();
  const { runner, interrupted } = interruptingRunner(inner, {
    matches: (command) => command === "cosign",
    afterMs: 5,
  });
  const result = await runner.run("kubectl", ["get"]);
  assert.equal(result.stdout, "ok");
  assert.equal(interrupted(), false);
});

test("only the first match is interrupted, so a rerun through the same runner is not killed", async () => {
  const inner = new Hanging();
  const { runner, interrupted } = interruptingRunner(inner, {
    matches: (command) => command === "helm",
    afterMs: 5,
  });
  await assert.rejects(runner.run("helm", ["hang"]));
  const second = await runner.run("helm", ["upgrade"]);
  assert.equal(second.code, 0);
  assert.equal(interrupted(), true);
});

test("a matching command that finishes before the delay is not counted as interrupted", async () => {
  const inner = new Hanging();
  const { runner, interrupted } = interruptingRunner(inner, {
    matches: () => true,
    afterMs: 60_000,
  });
  await runner.run("helm", ["upgrade"]);
  assert.equal(interrupted(), false);
});

test("with times set, every matching command up to that count is terminated", async () => {
  const inner = new Hanging();
  const { runner } = interruptingRunner(inner, {
    matches: (command) => command === "helm",
    afterMs: 5,
    times: 2,
  });
  await assert.rejects(runner.run("helm", ["hang"]));
  await assert.rejects(runner.run("helm", ["hang"]));
  assert.equal((await runner.run("helm", ["upgrade"])).code, 0);
});
