import { hostname, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hostLocksDirectory,
  type CliDeps,
  type FileSystem,
  type RunResult,
  type Runner,
} from "../runtime/index.js";
import { hostLeaseRefusal } from "./host-lease.js";

vi.mock("node:os");
vi.mock("node:path");
vi.mock("../runtime/index.js", async (original) => ({
  ...(await original<typeof import("../runtime/index.js")>()),
  hostLocksDirectory: vi.fn(),
}));

const NOW = "2026-01-02T03:04:05.000Z";
/** The host booted an hour before NOW, so a lease written before 02:04:05 predates the boot. */
const BOOT_SECONDS = 3600;
const LEASE = "/locks/host-lease.lock";
const HELD_SINCE = "2026-01-02T03:00:00.000Z";

/** The lease file kore writes, with fields the caller may override. */
const lease = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    pid: 4242,
    host: "devbox",
    token: "t",
    acquiredAt: HELD_SINCE,
    ...fields,
  });

const unjudged = (reason: string) =>
  `The host lease cannot be judged: ${reason}. Refusing the writer rather than risk loading a host with a live run. If no live run is going, remove ${LEASE} and spawn again. No session was started.`;

/**
 * Deps for the lease check: the lease file (undefined when absent) and the
 * answer `ps` gives. The runner is a typed mock, so each call is recorded.
 */
function deps(file: string | undefined, ps: Partial<RunResult> = {}) {
  const exists = vi.fn<FileSystem["exists"]>(() =>
    Promise.resolve(file !== undefined),
  );
  const readFile = vi.fn<FileSystem["readFile"]>(() =>
    Promise.resolve(file ?? ""),
  );
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({ stdout: "", stderr: "", code: 0, ...ps }),
  );
  // Only what the lease check touches; the rest of CliDeps is never read.
  const env = { KORE_ROOT: "/repo" };
  const fs = { exists, readFile } as Pick<FileSystem, "exists" | "readFile">;
  return {
    deps: { env, fs, runner: { run } } as unknown as CliDeps,
    exists,
    readFile,
    run,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(hostname).mockReturnValue("devbox");
  vi.mocked(uptime).mockReturnValue(BOOT_SECONDS);
  vi.mocked(hostLocksDirectory).mockReturnValue("/locks");
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hostLeaseRefusal lets a writer start when no live run holds the lease", () => {
  it("returns no refusal when there is no lease file, and asks nothing of ps", async () => {
    const d = deps(undefined);
    expect(await hostLeaseRefusal(d.deps)).toBeUndefined();
    expect(d.exists.mock.calls).toEqual([[LEASE]]);
    expect(d.run).not.toHaveBeenCalled();
  });

  it("treats a lease written before this host booted as free, because a reused pid survives a reboot", async () => {
    const d = deps(lease({ acquiredAt: "2026-01-02T01:00:00.000Z" }));
    expect(await hostLeaseRefusal(d.deps)).toBeUndefined();
    expect(d.run).not.toHaveBeenCalled();
  });

  it("returns no refusal when the lease's pid is gone (ps exits 1)", async () => {
    const d = deps(lease(), { code: 1 });
    expect(await hostLeaseRefusal(d.deps)).toBeUndefined();
    expect(d.run.mock.calls).toEqual([["ps", ["-p", "4242"]]]);
  });
});

describe("hostLeaseRefusal refuses a writer beside a live run", () => {
  it("names the holder's pid and time when ps finds the pid running", async () => {
    const d = deps(lease(), { code: 0 });
    expect(await hostLeaseRefusal(d.deps)).toBe(
      "A live run holds the host lease (pid 4242, since 2026-01-02T03:00:00.000Z), and a new writer would load the host beside it. Wait for the run to finish, then spawn again. No session was started.",
    );
    expect(d.run.mock.calls).toEqual([["ps", ["-p", "4242"]]]);
  });

  it("refuses, not frees, when ps itself fails, and names its exit code", async () => {
    const d = deps(lease(), { code: 2 });
    expect(await hostLeaseRefusal(d.deps)).toBe(
      unjudged("ps could not check pid 4242 (exit 2)"),
    );
  });

  it("reads the lease file at the lock directory's host-lease.lock", async () => {
    const d = deps(lease(), { code: 0 });
    await hostLeaseRefusal(d.deps);
    expect(hostLocksDirectory).toHaveBeenCalledWith(d.deps.env);
    expect(d.readFile.mock.calls).toEqual([[LEASE]]);
  });
});

describe("hostLeaseRefusal refuses a lease it cannot judge", () => {
  it.each([
    [
      "an unparseable file",
      "{not json",
      "the lease file cannot be read or parsed",
    ],
    [
      "no usable pid",
      lease({ pid: "4242" }),
      "the lease file has no usable pid and time",
    ],
    [
      "no acquisition time",
      lease({ acquiredAt: 5 }),
      "the lease file has no usable pid and time",
    ],
  ])(
    "refuses %s, naming the cause, without asking ps",
    async (_what, file, reason) => {
      const d = deps(file);
      expect(await hostLeaseRefusal(d.deps)).toBe(unjudged(reason));
      expect(d.run).not.toHaveBeenCalled();
    },
  );

  it("refuses a lease written on another host, since its holder cannot be checked here", async () => {
    const d = deps(lease({ host: "other-box" }));
    expect(await hostLeaseRefusal(d.deps)).toBe(
      unjudged(
        "the lease was written on host other-box, so its holder cannot be checked here",
      ),
    );
    expect(d.run).not.toHaveBeenCalled();
  });
});

describe("hostLeaseRefusal refuses when no lock directory is known", () => {
  it("names the lock directory's error and that no session started", async () => {
    vi.mocked(hostLocksDirectory).mockImplementation(() => {
      throw new Error("KORE_ROOT is not set");
    });
    const d = deps(undefined);
    expect(await hostLeaseRefusal(d.deps)).toBe(
      "KORE_ROOT is not set. No session was started.",
    );
    expect(d.exists).not.toHaveBeenCalled();
  });
});
