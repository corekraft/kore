import { expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { waitForClusterReady } from "./readiness.js";
import { commandLines, fakeRepository, fakeRunner } from "./cluster-support.js";

const readyz = "kubectl --context k3d-kore-local get --raw /readyz";
const nodes =
  'kubectl --context k3d-kore-local get nodes -o jsonpath={range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}';

/** A clock the test moves only through `sleep`, so a wait takes no real time. */
function fakeClock() {
  let now = 0;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  return { now: () => now, sleep };
}

function failure(stderr: string): CommandError {
  return new CommandError("kubectl", ["get", "--raw", "/readyz"], {
    stdout: "",
    stderr,
    code: 1,
  });
}

test("a cluster that is already ready is checked once for the API server and once for its nodes, with no wait", async () => {
  const { runner, run } = fakeRunner((_command, args) =>
    args.includes("nodes") ? "node-a=True\n" : "ok",
  );
  const clock = fakeClock();
  await waitForClusterReady(fakeRepository(), runner, {
    ...clock,
    timeoutMs: 10_000,
  });
  expect(commandLines(run)).toEqual([readyz, nodes]);
  expect(clock.sleep).not.toHaveBeenCalled();
});

test("the API server is retried every interval until /readyz answers, and only then are nodes checked", async () => {
  let attempts = 0;
  const { runner, run } = fakeRunner((_command, args) => {
    if (args.includes("/readyz") && ++attempts < 3) {
      throw failure("connection refused");
    }
    return args.includes("nodes") ? "node-a=True\n" : "ok";
  });
  const clock = fakeClock();
  await waitForClusterReady(fakeRepository(), runner, {
    ...clock,
    timeoutMs: 60_000,
    intervalMs: 3000,
  });
  expect(clock.sleep.mock.calls).toEqual([[3000], [3000]]);
  expect(commandLines(run)).toEqual([readyz, readyz, readyz, nodes]);
});

test("a timeout before the API server is ready names it, with its stderr, and says nothing was applied", async () => {
  const { runner } = fakeRunner(() => {
    throw failure("connection refused\n");
  });
  const clock = fakeClock();
  await expect(
    waitForClusterReady(fakeRepository(), runner, {
      ...clock,
      timeoutMs: 10_000,
      intervalMs: 3000,
    }),
  ).rejects.toThrow(
    "cluster k3d-kore-local was started but the API server (/readyz) was not ready within 10s: connection refused. Nothing was applied; check `k3d cluster list kore-local` and rerun.",
  );
  expect(clock.sleep).toHaveBeenCalledTimes(3);
});

test("a timeout while a node is not Ready names that node", async () => {
  const { runner } = fakeRunner((_command, args) =>
    args.includes("nodes") ? "node-a=True\nnode-b=False\n" : "ok",
  );
  await expect(
    waitForClusterReady(fakeRepository(), runner, {
      ...fakeClock(),
      timeoutMs: 1000,
      intervalMs: 1000,
    }),
  ).rejects.toThrow(
    "the node was not ready within 1s: node node-b is not Ready.",
  );
});

test("no node registering before the timeout is reported as no node having registered", async () => {
  const { runner } = fakeRunner((_command, args) =>
    args.includes("nodes") ? "\n" : "ok",
  );
  await expect(
    waitForClusterReady(fakeRepository(), runner, {
      ...fakeClock(),
      timeoutMs: 1000,
      intervalMs: 1000,
    }),
  ).rejects.toThrow(
    "the node was not ready within 1s: no node has registered.",
  );
});

test("a failure that is not a command error is reported by its message", async () => {
  const { runner } = fakeRunner(() => {
    throw new Error("socket hang up");
  });
  await expect(
    waitForClusterReady(fakeRepository(), runner, {
      ...fakeClock(),
      timeoutMs: 1000,
      intervalMs: 1000,
    }),
  ).rejects.toThrow(
    "API server (/readyz) was not ready within 1s: socket hang up.",
  );
});

test("the status hint names the k3d cluster, and is empty when the environment has no k3d settings", async () => {
  const { runner } = fakeRunner((_command, args) =>
    args.includes("nodes") ? "" : "ok",
  );
  await expect(
    waitForClusterReady(fakeRepository({ k3d: undefined }), runner, {
      ...fakeClock(),
      timeoutMs: 1000,
      intervalMs: 1000,
    }),
  ).rejects.toThrow("check `k3d cluster list ` and rerun.");
});
