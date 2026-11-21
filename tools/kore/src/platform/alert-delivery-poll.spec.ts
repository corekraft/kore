// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
import { expect, test, vi } from "vitest";
import { awaitValue, type Clock } from "./alert-delivery-poll.js";

function clock(start = 0) {
  let time = start;
  const sleep = vi.fn(async (ms: number) => {
    time += ms;
  });
  const deps: Clock = { now: () => time, sleep };
  return { deps, sleep };
}

test("returns the first value a read gives, without sleeping", async () => {
  const { deps, sleep } = clock();
  const value = await awaitValue(async () => "seen", 60_000, deps, 15);
  expect(value).toBe("seen");
  expect(sleep).not.toHaveBeenCalled();
});

test("reads again every poll interval until a value appears", async () => {
  const { deps, sleep } = clock();
  const answers: (number | undefined)[] = [undefined, undefined, 7];
  let next = 0;
  const value = await awaitValue(async () => answers[next++], 60_000, deps, 15);
  expect(value).toBe(7);
  expect(sleep.mock.calls).toEqual([[15_000], [15_000]]);
});

test("gives up with undefined at the first check past the deadline, never sleeping past it", async () => {
  const { deps, sleep } = clock();
  const read = vi.fn(async () => undefined);
  const value = await awaitValue(read, 20_000, deps, 15);
  expect(value).toBe(undefined);
  expect(read).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[15_000], [15_000]]);
});
