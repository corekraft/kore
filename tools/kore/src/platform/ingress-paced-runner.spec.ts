import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { PacedRunner } from "./ingress-paced-runner.js";

const REPLY = { stdout: "200\n", stderr: "", code: 0 };
const LOAD = ["--parallel", "https://kore.internal:443/livez#[1-10]"];
const PROBE = ["--write-out", "%{time_total}\\n"];

const inner = { run: vi.fn<Runner["run"]>() };
const deps = {
  sleep: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
  now: vi.fn(() => 0),
};

beforeEach(() => {
  vi.clearAllMocks();
  inner.run.mockResolvedValue(REPLY);
});

test("a load call returns the inner result and sleeps out the rest of its slot", async () => {
  vi.mocked(deps.now).mockReturnValueOnce(1000).mockReturnValueOnce(1100);

  const result = await new PacedRunner(inner, 0.25, deps).run("curl", LOAD, {
    capture: true,
  });

  expect(result).toBe(REPLY);
  expect(inner.run).toHaveBeenCalledExactlyOnceWith("curl", LOAD, {
    capture: true,
  });
  expect(deps.sleep).toHaveBeenCalledExactlyOnceWith(0.15);
});

test("a load call slower than its slot is followed by no sleep", async () => {
  vi.mocked(deps.now).mockReturnValueOnce(1000).mockReturnValueOnce(1400);

  await new PacedRunner(inner, 0.25, deps).run("curl", LOAD);

  expect(deps.sleep).not.toHaveBeenCalled();
});

test("a latency probe or any other command passes straight through, unpaced", async () => {
  const runner = new PacedRunner(inner, 0.25, deps);

  await runner.run("curl", PROBE);
  await runner.run("kubectl", ["get", "pods"]);

  expect(inner.run).toHaveBeenCalledTimes(2);
  expect(deps.now).not.toHaveBeenCalled();
  expect(deps.sleep).not.toHaveBeenCalled();
});

test("a failing load call is rethrown and not followed by a sleep", async () => {
  inner.run.mockRejectedValue(new Error("curl failed (7)"));

  await expect(
    new PacedRunner(inner, 0.25, deps).run("curl", LOAD),
  ).rejects.toThrow("curl failed (7)");
  expect(deps.sleep).not.toHaveBeenCalled();
});
