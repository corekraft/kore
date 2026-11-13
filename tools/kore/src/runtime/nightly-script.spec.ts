import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const script = new URL("../../scripts/nightly.sh", import.meta.url).pathname;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nightly-spec-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fake `kore` and suite runner that log each call, failing the ones named in `failOn`. */
function fakes(failOn: string[] = []) {
  const log = join(dir, "log");
  const fake = join(dir, "fake.sh");
  writeFileSync(
    fake,
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
for bad in ${failOn.map((f) => `"${f}"`).join(" ")}; do
  [ "$*" = "$bad" ] && exit 1
done
exit 0
`,
  );
  chmodSync(fake, 0o755);
  return { log, fake };
}

/** A stand-in for GNU timeout that only runs the command, so the order tests need no coreutils. */
function shimDir(): string {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "timeout"), '#!/bin/sh\nshift 2\nexec "$@"\n');
  chmodSync(join(bin, "timeout"), 0o755);
  return bin;
}

const hasGnuTimeout =
  spawnSync("sh", ["-c", "command -v timeout || command -v gtimeout"])
    .status === 0;

function run(
  suites: string[],
  failOn: string[] = [],
  extra: Record<string, string | undefined> = {},
) {
  const { log, fake } = fakes(failOn);
  const result = spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${shimDir()}:${process.env["PATH"] ?? ""}`,
      KORE_RUN_NIGHTLY: "1",
      KORE_NIGHTLY_KORE: `${fake} kore`,
      KORE_NIGHTLY_SUITE_CMD: `${fake} suite`,
      KORE_NIGHTLY_SUITES: suites.join("\n"),
      KORE_NIGHTLY_STAGE_TIMEOUT: "30s",
      ...extra,
    },
  });
  const calls = readFileSync(log, { encoding: "utf8", flag: "a+" })
    .split("\n")
    .filter(Boolean);
  return { ...result, calls };
}

test("the cluster stays up while the suites run, and cleanup runs last", () => {
  const { status, calls } = run(["test:integration:a", "test:integration:b"]);
  expect(status).toBe(0);
  expect(calls).toEqual([
    "kore local down --environment local --prune --purge-data",
    "kore local up --environment local",
    "kore platform status --environment local",
    "kore local up --environment local",
    "suite test:integration:a",
    "suite test:integration:b",
    "kore local down --environment local --prune --purge-data",
  ]);
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
    "kore local down --environment local --prune --purge-data",
  );
});

test("when local up fails the suites are skipped, and cleanup still runs", () => {
  const { status, stderr, calls } = run(
    ["test:integration:a"],
    ["kore local up --environment local"],
  );
  expect(status).toBe(1);
  expect(calls.some((call) => call.startsWith("suite"))).toBe(false);
  expect(stderr).toMatch(/skipping the suites/);
  expect(calls.at(-1)).toBe(
    "kore local down --environment local --prune --purge-data",
  );
});

test.skipIf(!hasGnuTimeout)(
  "a hung stage is stopped by timeout and named as timed out",
  () => {
    const { fake } = fakes();
    const hang = join(dir, "hang.sh");
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
    "kore local down --environment local --prune --purge-data",
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
  const { status, stderr } = run(["x"], [], { PATH: dir });
  expect(status).toBe(2);
  expect(stderr).toMatch(/GNU timeout.*coreutils/s);
});

test("it does nothing unless KORE_RUN_NIGHTLY=1", () => {
  const result = spawnSync("/bin/bash", [script], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toMatch(/skipped/);
});
