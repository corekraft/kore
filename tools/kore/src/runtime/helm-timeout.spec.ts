import { expect, test } from "vitest";
import type { RunOptions } from "./runner.js";
import { helmDeadlineMs, withHelmDeadline } from "./helm-timeout.js";
import { fakeRunner } from "./runtime-support.js";

const margin = 120_000;

/** Sends one call through the decorator and returns the inner runner's mock. */
async function throughDecorator(
  command: string,
  args: string[],
  options?: RunOptions,
) {
  const { runner, run } = fakeRunner();
  await withHelmDeadline(runner).run(command, args, options);
  return run;
}

test("a mutation may run twice its --timeout plus a margin, since a rollback waits again", async () => {
  const upgrade = await throughDecorator("helm", [
    "upgrade",
    "x",
    "--timeout",
    "10m",
  ]);
  const uninstall = await throughDecorator("helm", [
    "uninstall",
    "x",
    "--timeout=90s",
  ]);
  const rollback = await throughDecorator("helm", [
    "rollback",
    "x",
    "1",
    "--timeout",
    "1h",
  ]);
  expect(upgrade.mock.calls).toEqual([
    [
      "helm",
      ["upgrade", "x", "--timeout", "10m"],
      { timeoutMs: 2 * 600_000 + margin },
    ],
  ]);
  expect(uninstall.mock.calls).toEqual([
    [
      "helm",
      ["uninstall", "x", "--timeout=90s"],
      { timeoutMs: 2 * 90_000 + margin },
    ],
  ]);
  expect(rollback.mock.calls).toEqual([
    [
      "helm",
      ["rollback", "x", "1", "--timeout", "1h"],
      { timeoutMs: 2 * 3_600_000 + margin },
    ],
  ]);
});

test("an explicit timeoutMs, a read, and other tools are left alone", async () => {
  const explicit = await throughDecorator(
    "helm",
    ["upgrade", "--timeout", "10m"],
    { timeoutMs: 5 },
  );
  const read = await throughDecorator("helm", [
    "get",
    "values",
    "x",
    "--timeout",
    "10m",
  ]);
  const other = await throughDecorator("kubectl", ["apply", "--timeout=10m"]);
  expect(explicit.mock.calls).toEqual([
    ["helm", ["upgrade", "--timeout", "10m"], { timeoutMs: 5 }],
  ]);
  expect(read.mock.calls).toEqual([
    ["helm", ["get", "values", "x", "--timeout", "10m"], undefined],
  ]);
  expect(other.mock.calls).toEqual([
    ["kubectl", ["apply", "--timeout=10m"], undefined],
  ]);
});

test("helmDeadlineMs parses s, m and h and rejects anything else", () => {
  expect(helmDeadlineMs("30s")).toBe(2 * 30_000 + margin);
  expect(helmDeadlineMs("5x")).toBeUndefined();
  expect(helmDeadlineMs("")).toBeUndefined();
});
