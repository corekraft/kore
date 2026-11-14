// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { errorMessage } from "./probe.js";
import {
  failureAcrossBounds,
  pause,
  pollUntil,
  retryBudget,
  timeoutMilliseconds,
} from "./readiness-poll.js";

vi.mock("./probe.js");

type Probe = () => Promise<string | undefined>;
type Attempt = (bound: string) => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test("a 3s bound is 3000 ms, a 2m bound is 120000 ms and an hour is 3600000 ms", () => {
  expect(timeoutMilliseconds("3s")).toBe(3000);
  expect(timeoutMilliseconds("2m")).toBe(120000);
  expect(timeoutMilliseconds("1h")).toBe(3600000);
});

test("a bound that is not a number and a unit falls back to ten minutes", () => {
  expect(timeoutMilliseconds("soon")).toBe(600000);
  expect(timeoutMilliseconds("3d")).toBe(600000);
});

test("pause resolves after exactly 250 ms and not before", async () => {
  let resolved = false;
  const done = pause().then(() => {
    resolved = true;
  });

  await vi.advanceTimersByTimeAsync(249);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await done;
  expect(resolved).toBe(true);
});

test("a probe that reports ready at once is probed once and never paused", async () => {
  const probe = vi.fn<Probe>().mockResolvedValue(undefined);

  await pollUntil("10s", probe);

  expect(probe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("a probe that is not ready yet is probed again every 250 ms until it is ready", async () => {
  const probe = vi
    .fn<Probe>()
    .mockResolvedValueOnce("pending")
    .mockResolvedValueOnce("pending")
    .mockResolvedValueOnce(undefined);
  const done = pollUntil("10s", probe);

  await vi.advanceTimersByTimeAsync(249);
  expect(probe).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(probe).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(250);
  await done;

  expect(probe).toHaveBeenCalledTimes(3);
});

test("a wait that never becomes ready fails with the last reason at its bound, after 13 probes", async () => {
  const probe = vi.fn<Probe>().mockResolvedValue("deployment/web not ready");
  const outcome = expect(pollUntil("3s", probe)).rejects.toThrow(
    "deployment/web not ready",
  );

  await vi.advanceTimersByTimeAsync(3000);
  await outcome;

  expect(probe).toHaveBeenCalledTimes(13);
});

test("a Forbidden error fails at once with the same error and is not probed again", async () => {
  const forbidden = new Error('secrets "x" is forbidden: Forbidden');
  const probe = vi.fn<Probe>().mockRejectedValue(forbidden);

  await expect(pollUntil("10s", probe)).rejects.toBe(forbidden);

  expect(probe).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("malformed JSON fails at once as a SyntaxError and is not probed again", async () => {
  const probe = vi.fn<Probe>(async () => {
    JSON.parse("not json");
    return undefined;
  });

  await expect(pollUntil("10s", probe)).rejects.toBeInstanceOf(SyntaxError);

  expect(probe).toHaveBeenCalledTimes(1);
});

test("a NotFound error is retried until the resource appears", async () => {
  const notFound = new Error(
    'Error from server (NotFound): gateways "x" not found',
  );
  const probe = vi
    .fn<Probe>()
    .mockRejectedValueOnce(notFound)
    .mockResolvedValueOnce(undefined);
  const done = pollUntil("10s", probe);

  await vi.advanceTimersByTimeAsync(250);
  await done;

  expect(probe).toHaveBeenCalledTimes(2);
});

test("a missing resource type is retried until it is served", async () => {
  const noType = new Error(
    'error: the server doesn\'t have a resource type "x"',
  );
  const probe = vi
    .fn<Probe>()
    .mockRejectedValueOnce(noType)
    .mockResolvedValueOnce(undefined);
  const done = pollUntil("10s", probe);

  await vi.advanceTimersByTimeAsync(250);
  await done;

  expect(probe).toHaveBeenCalledTimes(2);
});

test("an unreachable cluster context is rethrown at once and is not retried", async () => {
  const probe = vi
    .fn<Probe>()
    .mockRejectedValue(new Error("the context k3d-kore-local is unreachable"));

  await expect(pollUntil("10s", probe)).rejects.toThrow("unreachable");

  expect(probe).toHaveBeenCalledTimes(1);
});

test("the first bound's failure does not spend the retry budget", async () => {
  const budget = retryBudget();
  const attempt = vi.fn<Attempt>().mockResolvedValue(undefined);

  expect(await failureAcrossBounds(["3s", "15s"], attempt, budget)).toBe(
    undefined,
  );

  expect(budget.spent).toBe(false);
  expect(attempt.mock.calls).toEqual([["3s"]]);
});

test("a timed-out first bound is retried at the longer bound, and a pass there returns no failure", async () => {
  const attempt = vi
    .fn<Attempt>()
    .mockRejectedValueOnce(
      new Error("error: timed out waiting for the condition on crd/x"),
    )
    .mockResolvedValueOnce(undefined);

  expect(await failureAcrossBounds(["3s", "15s"], attempt)).toBe(undefined);

  expect(attempt.mock.calls).toEqual([["3s"], ["15s"]]);
});

test("a failure that is not a timeout is reported at once, without the longer bound", async () => {
  const attempt = vi
    .fn<Attempt>()
    .mockRejectedValue(new Error("the condition Established is not available"));

  expect(await failureAcrossBounds(["3s", "15s"], attempt)).toMatch(
    /not available/,
  );

  expect(attempt.mock.calls).toEqual([["3s"]]);
});

test("a retry that also times out spends the budget and reports the longer bound's failure", async () => {
  const budget = retryBudget();
  const timedOut = new Error("error: timed out waiting for the condition");
  const attempt = vi.fn<Attempt>().mockRejectedValue(timedOut);

  const failure = await failureAcrossBounds(["3s", "15s"], attempt, budget);

  expect(failure).toBe("error: timed out waiting for the condition");
  expect(budget.spent).toBe(true);
  expect(attempt.mock.calls).toEqual([["3s"], ["15s"]]);
});

test("once the budget is spent, a later timed-out component is not given the longer bound", async () => {
  const budget = { spent: true };
  const attempt = vi
    .fn<Attempt>()
    .mockRejectedValue(new Error("error: timed out waiting for the condition"));

  await failureAcrossBounds(["3s", "15s"], attempt, budget);

  expect(attempt.mock.calls).toEqual([["3s"]]);
});
