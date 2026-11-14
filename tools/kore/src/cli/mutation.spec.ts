import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import {
  hostRoot,
  lockScope,
  withEnvironmentLock,
  withHostLease,
  withJournal,
} from "../runtime/index.js";
import type { Runner } from "../runtime/index.js";
import { createMutate, lockWaitMs } from "./mutation.js";

// Real locks and journal files are integration tests (tools/kore/integration).
// Here the lock, lease and journal are typed mocks, and the clock is not read.

vi.mock("../runtime/index.js");

const tenMinutes = 10 * 60 * 1000;
const thirtyMinutes = 30 * 60 * 1000;
const runner = {} as Runner;
const repository = {
  root: "/repo",
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

beforeEach(() => {
  delete process.env.KORE_LOCK_WAIT_MS;
  vi.mocked(hostRoot).mockReturnValue("/host");
  vi.mocked(lockScope).mockReturnValue("kore-local");
  vi.mocked(withEnvironmentLock).mockImplementation(
    async (_root, _scope, operation) => operation(),
  );
  vi.mocked(withHostLease).mockImplementation(async (operation) => operation());
  vi.mocked(withJournal).mockImplementation(async (_entry, _runner, work) =>
    work(runner),
  );
});

afterEach(() => {
  delete process.env.KORE_LOCK_WAIT_MS;
});

function mutateFor(action: string, command = "local") {
  return createMutate({
    command,
    action,
    mutations: ["up", "stop"],
    environmentName: "local",
    repository,
    runner,
  });
}

test("an ordinary mutation takes the environment lock for ten minutes and no host lease", async () => {
  await mutateFor("stop")("stop local", async () => 0);
  expect(withHostLease).not.toHaveBeenCalled();
  expect(withEnvironmentLock).toHaveBeenCalledWith(
    "/host",
    "kore-local",
    expect.any(Function),
    { waitMs: tenMinutes },
  );
});

test("kore local up takes the exclusive host lease first, then the environment lock, waiting thirty minutes", async () => {
  await mutateFor("up")("up local", async () => 0);
  expect(withHostLease).toHaveBeenCalledWith(expect.any(Function), {
    waitMs: thirtyMinutes,
  });
  expect(withEnvironmentLock).toHaveBeenCalledWith(
    "/host",
    "kore-local",
    expect.any(Function),
    { waitMs: thirtyMinutes },
  );
});

test("the mutation is journaled under its label, cluster context and the repository root, with the runner it is given", async () => {
  const work = vi.fn(async () => 0);
  await mutateFor("stop")("stop local", work);
  expect(withJournal).toHaveBeenCalledWith(
    {
      root: "/repo",
      environment: "local",
      command: "stop local",
      context: "k3d-kore-local",
    },
    runner,
    work,
  );
});

test("the mutation returns the result of its work", async () => {
  expect(await mutateFor("stop")("stop local", async () => 7)).toBe(7);
});

test("an action the command does not list is refused before any lock or journal entry", async () => {
  await expect(
    mutateFor("destroy")("destroy local", async () => 0),
  ).rejects.toThrow("unknown local action: destroy");
  expect(withEnvironmentLock).not.toHaveBeenCalled();
  expect(withJournal).not.toHaveBeenCalled();
  expect(withHostLease).not.toHaveBeenCalled();
});

test("lockWaitMs gives kore local up thirty minutes and every other mutation ten", () => {
  expect(lockWaitMs("local", "up")).toBe(thirtyMinutes);
  expect(lockWaitMs("local", "stop")).toBe(tenMinutes);
  expect(lockWaitMs("app", "up")).toBe(tenMinutes);
});

test("KORE_LOCK_WAIT_MS overrides the wait for every mutation, including local up", () => {
  process.env.KORE_LOCK_WAIT_MS = "1234";
  expect(lockWaitMs("local", "up")).toBe(1234);
  expect(lockWaitMs("local", "stop")).toBe(1234);
});

test("a KORE_LOCK_WAIT_MS that is not whole milliseconds is refused, naming the value and the fix", () => {
  process.env.KORE_LOCK_WAIT_MS = "10m";
  expect(() => lockWaitMs("local", "up")).toThrow(
    'KORE_LOCK_WAIT_MS must be a whole number of milliseconds, got "10m"; unset it for the default',
  );
});
