import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ctx,
  fakes,
  hasGnuTimeout,
  run,
  useNightlySandbox,
} from "./nightly-script.fixtures.js";

useNightlySandbox();

test("the cluster stays up while the suites run, and cleanup runs last", () => {
  const { status, calls } = run(["test:integration:a", "test:integration:b"]);
  expect(status).toBe(0);
  expect(calls).toEqual([
    "kore local down --environment nightly --prune --purge-data",
    "kore local up --environment nightly",
    "kore platform status --environment nightly",
    "kore local up --environment nightly",
    "suite test:integration:a",
    "suite test:integration:b",
    "kore local down --environment nightly --prune --purge-data",
  ]);
});

test("the lifecycle suite runs last, whatever order discovery gives, so it never tears the cluster down under the others", () => {
  const { status, calls } = run([
    "test:integration:lifecycle",
    "test:integration:a",
    "test:integration:b",
  ]);
  expect(status).toBe(0);
  const suites = calls.filter((call) => call.startsWith("suite"));
  expect(suites).toEqual([
    "suite test:integration:a",
    "suite test:integration:b",
    "suite test:integration:lifecycle",
  ]);
  expect(calls.at(-1)).toBe(
    "kore local down --environment nightly --prune --purge-data",
  );
});

test("the bare test:integration task is not a nightly suite, because it runs the unit suite", () => {
  const { status, calls } = run(["test:integration", "test:integration:a"]);
  expect(status).toBe(0);
  expect(calls.filter((call) => call.startsWith("suite"))).toEqual([
    "suite test:integration:a",
  ]);
});

test("a night whose only suite is the bare task still fails as finding none", () => {
  const { status, stderr, calls } = run(["test:integration"]);
  expect(status).toBe(1);
  expect(stderr).toMatch(/found no test:integration suites/);
  expect(calls.some((call) => call.startsWith("suite"))).toBe(false);
});

test("a failing suite never hides the ones after it, is named, and cleanup still runs last", () => {
  const { status, stderr, calls } = run(
    ["test:integration:a", "test:integration:b"],
    ["suite test:integration:a"],
  );
  expect(status).toBe(1);
  expect(stderr).toMatch(/failed: .*test:integration:a/);
  expect(calls.at(-2)).toBe("suite test:integration:b");
  expect(calls.at(-1)).toBe(
    "kore local down --environment nightly --prune --purge-data",
  );
});

test("when local up fails the suites are skipped, and cleanup still runs", () => {
  const { status, stderr, calls } = run(
    ["test:integration:a"],
    ["kore local up --environment nightly"],
  );
  expect(status).toBe(1);
  expect(calls.some((call) => call.startsWith("suite"))).toBe(false);
  expect(stderr).toMatch(/skipping the suites/);
  expect(calls.at(-1)).toBe(
    "kore local down --environment nightly --prune --purge-data",
  );
});

test.skipIf(!hasGnuTimeout)(
  "a hung stage is stopped by timeout and named as timed out",
  () => {
    const { fake } = fakes();
    const hang = join(ctx.dir, "hang.sh");
    writeFileSync(
      hang,
      `#!/usr/bin/env bash
case "$*" in "suite test:integration:slow") exec sleep 30 ;; esac
exec "${fake}" "$@"
`,
    );
    chmodSync(hang, 0o755);
    const { status, stderr } = run(["test:integration:slow"], [], {
      KORE_NIGHTLY_SUITE_CMD: `${hang} suite`,
      KORE_NIGHTLY_STAGE_TIMEOUT: "1s",
      KORE_NIGHTLY_KILL_AFTER: "1s",
      PATH: process.env["PATH"] ?? "",
    });
    expect(status).toBe(1);
    expect(stderr).toMatch(/test:integration:slow \(timed out\)/);
  },
);

test("a night that finds no suites fails instead of passing green, and cleanup still runs", () => {
  const { status, stderr, calls } = run([]);
  expect(status).toBe(1);
  expect(stderr).toMatch(/found no test:integration suites/);
  expect(calls.some((call) => call.startsWith("suite"))).toBe(false);
  expect(calls.at(-1)).toBe(
    "kore local down --environment nightly --prune --purge-data",
  );
});

test("a failing suite discovery fails the night and names the cause", () => {
  const { status, stderr } = run([], [], {
    KORE_NIGHTLY_SUITES: undefined,
    KORE_NIGHTLY_DISCOVER_CMD: "echo boom >&2; exit 3",
  });
  expect(status).toBe(1);
  expect(stderr).toMatch(/suite discovery failed/);
});

test("it refuses to run without GNU timeout and says how to get it", () => {
  const { status, stderr } = run(["x"], [], { PATH: ctx.dir });
  expect(status).toBe(2);
  expect(stderr).toMatch(/GNU timeout.*coreutils/s);
});

test("it does nothing unless KORE_RUN_NIGHTLY=1", () => {
  const result = spawnSync("/bin/bash", [ctx.script], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toMatch(/skipped/);
});
