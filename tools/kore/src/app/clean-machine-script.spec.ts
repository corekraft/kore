import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const script = new URL("../../scripts/clean-machine-e2e.sh", import.meta.url)
  .pathname;

test("the clean-machine end-to-end script does nothing unless explicitly opted in", async () => {
  // Without the opt-in the script exits before running any tool: no mise,
  // kore, k3d or docker call, so this is safe in ordinary runs.
  const { stdout, stderr } = await promisify(execFile)("bash", [script], {
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(stdout).toBe("");
  expect(stderr).toMatch(/skipped: set KORE_RUN_CLEAN_MACHINE=1/);
});

test("the clean-machine script judges platform components only, not the cluster-wide capacity and backup rows", async () => {
  // `kore platform status --json` ends with rows for the cluster as a whole
  // (namespace "cluster"). A fresh install with retained data has no export
  // yet, so its backups row is degraded by design; `kore data export` covers it.
  const source = await readFile(script, "utf8");

  expect(source).toMatch(/namespace\s*!==\s*"cluster"/);
  expect(source).not.toMatch(/grep -q '"status": "\\\(missing/);
});

test("the clean-machine script sets up the local k3d platform and always tears it down with its data purged", async () => {
  // It reads the script text only; nothing here creates or deletes a cluster.
  const source = await readFile(script, "utf8");

  expect(source).toMatch(/local up --environment/);
  expect(source).toMatch(/local down --environment[^\n]*--prune --purge-data/);
  expect(source).toMatch(/trap cleanup EXIT/);
});
