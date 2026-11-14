import { loadavg } from "node:os";
import { expect, it, vi } from "vitest";
import { systemHostLoad } from "./host-load.js";

vi.mock("node:os");

it("reads the host's one-minute load average, the first of the three", () => {
  vi.mocked(loadavg).mockReturnValue([44.5, 30, 20]);

  expect(systemHostLoad.oneMinute()).toBe(44.5);
});

it("reads a host that reports no load average as infinitely loaded, so a ceiling refuses", () => {
  vi.mocked(loadavg).mockReturnValue([]);

  expect(systemHostLoad.oneMinute()).toBe(Number.POSITIVE_INFINITY);
});
