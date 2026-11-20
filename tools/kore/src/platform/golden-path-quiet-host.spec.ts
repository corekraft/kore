import { expect, test, vi } from "vitest";
import { waitForQuietHost } from "./golden-path-quiet-host.js";

const quiet = { maxLoadAverage: 10, maxPolls: 3, pollIntervalSeconds: 5 };

test("waitForQuietHost returns at once, without sleeping, when the host load is already under the limit", async () => {
  const sleep = vi.fn<(seconds: number) => Promise<void>>(async () => {});
  const loadAverage = vi.fn(() => 3);

  await expect(waitForQuietHost({ sleep, loadAverage }, quiet)).resolves.toBe(
    3,
  );

  expect(sleep).not.toHaveBeenCalled();
});

test("waitForQuietHost reads the load once per poll interval until it falls under the limit, then returns the load it read", async () => {
  const sleep = vi.fn<(seconds: number) => Promise<void>>(async () => {});
  const loadAverage = vi
    .fn<() => number>()
    .mockReturnValueOnce(14)
    .mockReturnValueOnce(11)
    .mockReturnValueOnce(9.5);

  await expect(waitForQuietHost({ sleep, loadAverage }, quiet)).resolves.toBe(
    9.5,
  );

  expect(sleep.mock.calls).toEqual([[5], [5]]);
});

test("waitForQuietHost counts a load equal to the limit as busy, as the check refuses it", async () => {
  const sleep = vi.fn<(seconds: number) => Promise<void>>(async () => {});
  const loadAverage = vi
    .fn<() => number>()
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(9.9);

  await expect(waitForQuietHost({ sleep, loadAverage }, quiet)).resolves.toBe(
    9.9,
  );

  expect(sleep.mock.calls).toEqual([[5]]);
});

test("waitForQuietHost refuses, naming the load and the limit, once the host has not quieted within its poll budget", async () => {
  const sleep = vi.fn<(seconds: number) => Promise<void>>(async () => {});
  const loadAverage = vi.fn(() => 12);

  await expect(waitForQuietHost({ sleep, loadAverage }, quiet)).rejects.toThrow(
    "host 1-minute load average 12 did not fall below 10 within 15 seconds; wait for the host to quiet down and rerun",
  );

  expect(loadAverage).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[5], [5]]);
});
