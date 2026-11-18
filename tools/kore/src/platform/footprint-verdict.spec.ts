import { expect, test } from "vitest";
import { judgeFootprint } from "./footprint-verdict.js";

test("reports no breach when the peak VM memory in use is at most 85 percent of the VM, the boundary included", () => {
  expect(
    judgeFootprint({
      peakInUseMiB: 8500,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({ breached: false, breaches: [] });
});

test("reports a memory breach with the peak in-use figure that tripped it when the peak is above 85 percent", () => {
  expect(
    judgeFootprint({
      peakInUseMiB: 8510,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({
    breached: true,
    breaches: [{ rule: "memory", usedPercentAtPeak: 85.1, ceilingPercent: 85 }],
  });
});

test("breaches on the VM's in-use peak alone, so a small server container cannot hide a swamped VM", () => {
  // The verdict is handed only the VM's in-use peak, never the server's memory.
  expect(
    judgeFootprint({
      peakInUseMiB: 9000,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({
    breached: true,
    breaches: [{ rule: "memory", usedPercentAtPeak: 90, ceilingPercent: 85 }],
  });
});

test("names each pod that was OOMKilled, and breaches on it even with memory clean", () => {
  expect(
    judgeFootprint({
      peakInUseMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: ["platform/keycloak-0"],
    }),
  ).toEqual({
    breached: true,
    breaches: [{ rule: "oomkilled", pods: ["platform/keycloak-0"] }],
  });
});

test("reports no breach when VM memory in use stayed at or under the ceiling and no pod was OOMKilled", () => {
  expect(
    judgeFootprint({
      peakInUseMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({ breached: false, breaches: [] });
});

test("lists both breaches, memory first, when memory and an OOMKilled pod both trip", () => {
  expect(
    judgeFootprint({
      peakInUseMiB: 9000,
      vmMemoryMiB: 10000,
      oomKilledPods: ["argocd/server-0"],
    }),
  ).toEqual({
    breached: true,
    breaches: [
      { rule: "memory", usedPercentAtPeak: 90, ceilingPercent: 85 },
      { rule: "oomkilled", pods: ["argocd/server-0"] },
    ],
  });
});

test("ignores swap: a run whose memory is clean reports no breach whatever the host swap", () => {
  // The verdict takes no swap figure at all, so swap cannot trip it.
  expect(
    judgeFootprint({
      peakInUseMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }).breached,
  ).toBe(false);
});
