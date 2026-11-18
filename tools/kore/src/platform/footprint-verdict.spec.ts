import { expect, test } from "vitest";
import { judgeFootprint } from "./footprint-verdict.js";

test("reports no breach when the peak memory is at most 85 percent of the VM, the boundary included", () => {
  expect(
    judgeFootprint({
      peakMemoryMiB: 8500,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({ breached: false, breaches: [] });
});

test("reports a memory breach with the peak figure that tripped it when the peak is above 85 percent", () => {
  expect(
    judgeFootprint({
      peakMemoryMiB: 8510,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({
    breached: true,
    breaches: [{ rule: "memory", usedPercentAtPeak: 85.1, ceilingPercent: 85 }],
  });
});

test("names each pod that was OOMKilled, and breaches on it even with memory clean", () => {
  expect(
    judgeFootprint({
      peakMemoryMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: ["platform/keycloak-0"],
    }),
  ).toEqual({
    breached: true,
    breaches: [{ rule: "oomkilled", pods: ["platform/keycloak-0"] }],
  });
});

test("reports no breach when memory stayed at or under the ceiling and no pod was OOMKilled", () => {
  expect(
    judgeFootprint({
      peakMemoryMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }),
  ).toEqual({ breached: false, breaches: [] });
});

test("lists both breaches, memory first, when memory and an OOMKilled pod both trip", () => {
  expect(
    judgeFootprint({
      peakMemoryMiB: 9000,
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
      peakMemoryMiB: 8000,
      vmMemoryMiB: 10000,
      oomKilledPods: [],
    }).breached,
  ).toBe(false);
});
