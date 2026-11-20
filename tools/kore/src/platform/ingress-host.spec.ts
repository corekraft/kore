import { beforeEach, expect, test, vi } from "vitest";
import type { Runner } from "../runtime/index.js";
import { parseSwapUsedMiB } from "./footprint-parse.js";
import { HostConditions, type HostDeps } from "./ingress-host.js";
import {
  parseAgentPaneCount,
  parseLinuxSwapUsedMiB,
  parseMemAvailableMiB,
} from "./ingress-host-parse.js";

// The parsers are same-domain units, so they are typed stubs here; their own
// specs cover the text they read.
vi.mock("./footprint-parse.js", () => ({ parseSwapUsedMiB: vi.fn() }));
vi.mock("./ingress-host-parse.js", () => ({
  parseAgentPaneCount: vi.fn(),
  parseLinuxSwapUsedMiB: vi.fn(),
  parseMemAvailableMiB: vi.fn(),
}));

const SERVER = "k3d-kore-local-server-0";
const outputs: Record<string, string> = {
  sysctl: "swap-text",
  docker: "meminfo-text",
  herdr: "herdr-text",
};
const run = vi.fn<Runner["run"]>();
const readFile = vi.fn<(path: string) => Promise<string>>();
const deps: HostDeps = {
  platform: "darwin",
  loadAverages: vi.fn((): [number, number, number] => [1.5, 2.5, 3.5]),
  readFile,
};
const host = (platform: NodeJS.Platform = "darwin") =>
  new HostConditions({ run }, SERVER, { ...deps, platform });

const HOST_MEMINFO = "/proc/meminfo";
const HOST_MEMINFO_READ_FAILED =
  "reading the host's swap and memory in /proc/meminfo failed";
const HOST_MEMINFO_HINT = "check that /proc/meminfo is readable on this host";

beforeEach(() => {
  vi.clearAllMocks();
  run.mockImplementation(async (command) => ({
    code: 0,
    stdout: outputs[command] ?? "",
    stderr: "",
  }));
  readFile.mockResolvedValue("meminfo-linux-text");
  vi.mocked(parseSwapUsedMiB).mockReturnValue(512);
  vi.mocked(parseLinuxSwapUsedMiB).mockReturnValue(256);
  vi.mocked(parseMemAvailableMiB).mockReturnValue(4096);
  vi.mocked(parseAgentPaneCount).mockReturnValue(7);
});

test("reads the 1, 5 and 15 minute load, swap used, free VM memory and agent pane count", async () => {
  expect(await host().read()).toEqual({
    load: { oneMinute: 1.5, fiveMinute: 2.5, fifteenMinute: 3.5 },
    swapUsedMiB: 512,
    vmFreeMiB: 4096,
    agentPanes: { count: 7, source: "herdr agent list" },
  });
});

test("reads each value from the process that owns it and parses that process's output", async () => {
  await host().read();

  expect(run.mock.calls).toEqual([
    ["sysctl", ["vm.swapusage"], { capture: true }],
    ["docker", ["exec", SERVER, "cat", "/proc/meminfo"], { capture: true }],
    ["herdr", ["agent", "list"], { capture: true }],
  ]);
  expect(parseSwapUsedMiB).toHaveBeenCalledWith("swap-text");
  expect(parseMemAvailableMiB).toHaveBeenCalledWith("meminfo-text");
  expect(parseAgentPaneCount).toHaveBeenCalledWith("herdr-text");
});

test("on macOS never reads the host's /proc/meminfo", async () => {
  await host("darwin").read();

  expect(readFile).not.toHaveBeenCalled();
  expect(parseLinuxSwapUsedMiB).not.toHaveBeenCalled();
});

test("on Linux reads the load, swap and free memory from the host's /proc/meminfo, and the pane count", async () => {
  expect(await host("linux").read()).toEqual({
    load: { oneMinute: 1.5, fiveMinute: 2.5, fifteenMinute: 3.5 },
    swapUsedMiB: 256,
    vmFreeMiB: 4096,
    agentPanes: { count: 7, source: "herdr agent list" },
  });
});

test("on Linux runs no sysctl and no docker: the only process read is the herdr listing", async () => {
  await host("linux").read();

  expect(readFile).toHaveBeenCalledWith(HOST_MEMINFO);
  expect(run.mock.calls).toEqual([
    ["herdr", ["agent", "list"], { capture: true }],
  ]);
});

test("on Linux parses the one /proc/meminfo text for both swap and available memory", async () => {
  await host("linux").read();

  expect(parseLinuxSwapUsedMiB).toHaveBeenCalledWith("meminfo-linux-text");
  expect(parseMemAvailableMiB).toHaveBeenCalledWith("meminfo-linux-text");
});

test("on Linux names the unreadable /proc/meminfo and how to fix it", async () => {
  readFile.mockRejectedValue(new Error("EACCES: permission denied"));

  await expect(host("linux").read()).rejects.toThrow(
    `${HOST_MEMINFO_READ_FAILED}: EACCES: permission denied; ${HOST_MEMINFO_HINT}`,
  );
});

test("on Linux names the parse cause when the host's swap cannot be read", async () => {
  vi.mocked(parseLinuxSwapUsedMiB).mockImplementation(() => {
    throw new Error("unreadable host swap report");
  });

  await expect(host("linux").read()).rejects.toThrow(
    `${HOST_MEMINFO_READ_FAILED}: unreadable host swap report; ${HOST_MEMINFO_HINT}`,
  );
});

test("reports a missing pane count source by name with a null count, never a silent zero", async () => {
  run.mockImplementation(async (command) => {
    if (command === "herdr") {
      throw new Error("spawn herdr ENOENT");
    }
    return { code: 0, stdout: "", stderr: "" };
  });

  const snapshot = await host().read();

  expect(snapshot.agentPanes).toEqual({
    count: null,
    source: "herdr agent list",
    missing: "spawn herdr ENOENT",
  });
  expect(snapshot.swapUsedMiB).toBe(512);
});

test("reports an unreadable herdr listing as a missing source, naming the parse cause", async () => {
  vi.mocked(parseAgentPaneCount).mockImplementation(() => {
    throw new Error("herdr agent list did not print JSON");
  });

  expect((await host().read()).agentPanes).toEqual({
    count: null,
    source: "herdr agent list",
    missing: "herdr agent list did not print JSON",
  });
});

test.each([
  ["sysctl", "the macOS swap usage", "this measurement needs macOS"],
  [
    "docker",
    `the free memory of the Docker VM, read in ${SERVER}`,
    `check that Docker is running and ${SERVER} exists`,
  ],
])(
  "fails naming what could not be read when %s fails",
  async (command, subject, hint) => {
    run.mockImplementation(async (name) => {
      if (name === command) {
        throw new Error("boom");
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    await expect(host().read()).rejects.toThrow(
      `reading ${subject} failed: boom; ${hint}`,
    );
  },
);
