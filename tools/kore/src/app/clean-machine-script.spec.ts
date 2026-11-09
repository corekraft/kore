import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const script = new URL("../../scripts/clean-machine-e2e.sh", import.meta.url)
  .pathname;

test("the clean-machine end-to-end script does nothing unless explicitly opted in", async () => {
  // Without the opt-in the script exits before running any tool: no mise,
  // kore, minikube or docker call, so this is safe in ordinary runs.
  const { stdout, stderr } = await promisify(execFile)("bash", [script], {
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(stdout).toBe("");
  expect(stderr).toMatch(/skipped: set KORE_RUN_CLEAN_MACHINE=1/);
});
