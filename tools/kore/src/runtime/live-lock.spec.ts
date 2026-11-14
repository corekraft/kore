import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import { HOST_LEASE } from "./host-lease.js";
import { hostRoot, lockScope } from "./host-locks.js";
import { holdLiveLock } from "./live-lock.js";
import { isSet, liveEnvironment } from "./live-environment.js";
import { holdEnvironmentLock, inheritsLock } from "./lock.js";
import { systemError } from "./runtime-support.js";

vi.mock("../config/index.js");
vi.mock("./host-locks.js");
vi.mock("./live-environment.js");
vi.mock("./lock.js");

const TEN_MINUTES = 10 * 60 * 1000;

function fakeHeld() {
  return { release: vi.fn(async () => undefined), releaseSync: vi.fn() };
}

/** Process hooks that record each listener, so a test can fire one. */
function fakeProcess() {
  const listeners = new Map<string, () => void>();
  return {
    hooks: {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      exit: vi.fn<(code: number) => unknown>(),
    },
    fire: (event: string) => listeners.get(event)?.(),
  };
}

let lease: ReturnType<typeof fakeHeld>;
let lock: ReturnType<typeof fakeHeld>;

beforeEach(() => {
  process.env.KORE_RUN_LIVE = "1";
  vi.mocked(isSet).mockImplementation(
    (value) => value !== undefined && value !== "",
  );
  vi.mocked(liveEnvironment).mockReturnValue("local");
  vi.mocked(hostRoot).mockReturnValue("/host");
  vi.mocked(lockScope).mockReturnValue("kore-local");
  vi.mocked(inheritsLock).mockResolvedValue(false);
  lease = fakeHeld();
  lock = fakeHeld();
  vi.mocked(holdEnvironmentLock)
    .mockResolvedValueOnce(lease)
    .mockResolvedValueOnce(lock);
});

afterEach(() => {
  delete process.env.KORE_RUN_LIVE;
  delete process.env.KORE_RUN_INTEGRATION;
  delete process.env.KORE_INTEGRATION_LOCK_WAIT_MS;
  delete process.env.KORE_LIVE_LOCK_WAIT_MS;
});

describe("holdLiveLock: opting in", () => {
  it("takes no lock unless live specs are opted into", async () => {
    delete process.env.KORE_RUN_LIVE;

    await holdLiveLock({
      scope: async () => "kore-local",
      process: fakeProcess().hooks,
    });

    expect(holdEnvironmentLock).not.toHaveBeenCalled();
  });

  it("refuses the retired KORE_RUN_INTEGRATION, naming KORE_RUN_LIVE, rather than skipping", async () => {
    process.env.KORE_RUN_INTEGRATION = "1";

    await expect(
      holdLiveLock({
        scope: async () => "kore-local",
        process: fakeProcess().hooks,
      }),
    ).rejects.toThrow(/KORE_RUN_INTEGRATION is retired; set KORE_RUN_LIVE=1/);
    expect(holdEnvironmentLock).not.toHaveBeenCalled();
  });

  it("refuses the retired KORE_INTEGRATION_LOCK_WAIT_MS, naming KORE_LIVE_LOCK_WAIT_MS", async () => {
    process.env.KORE_INTEGRATION_LOCK_WAIT_MS = "5";

    await expect(
      holdLiveLock({
        scope: async () => "kore-local",
        process: fakeProcess().hooks,
      }),
    ).rejects.toThrow(
      /KORE_INTEGRATION_LOCK_WAIT_MS is retired; set KORE_LIVE_LOCK_WAIT_MS/,
    );
    expect(holdEnvironmentLock).not.toHaveBeenCalled();
  });

  it("does nothing when the caller already inherits the holder's token", async () => {
    vi.mocked(inheritsLock).mockResolvedValue(true);

    await holdLiveLock({
      scope: async () => "kore-local",
      process: fakeProcess().hooks,
    });

    expect(holdEnvironmentLock).not.toHaveBeenCalled();
  });
});

describe("holdLiveLock: taking the locks", () => {
  it("takes the host lease first, then the cluster lock, under the live wait", async () => {
    process.env.KORE_LIVE_LOCK_WAIT_MS = "5000";

    await holdLiveLock({
      scope: async () => "kore-local",
      process: fakeProcess().hooks,
    });

    expect(holdEnvironmentLock).toHaveBeenNthCalledWith(
      1,
      "/host",
      HOST_LEASE,
      {
        waitMs: 5000,
      },
    );
    expect(holdEnvironmentLock).toHaveBeenNthCalledWith(
      2,
      "/host",
      "kore-local",
      {
        waitMs: 5000,
      },
    );
  });

  it("waits up to ten minutes by default", async () => {
    await holdLiveLock({
      scope: async () => "kore-local",
      process: fakeProcess().hooks,
    });

    expect(holdEnvironmentLock).toHaveBeenCalledWith("/host", HOST_LEASE, {
      waitMs: TEN_MINUTES,
    });
  });

  it("names the lock after the scope of the environment KORE_LIVE_ENVIRONMENT names", async () => {
    vi.mocked(loadRepository).mockResolvedValue({
      environment: "local",
    } as never);

    await holdLiveLock({ process: fakeProcess().hooks });

    expect(loadRepository).toHaveBeenCalledWith("local");
    expect(holdEnvironmentLock).toHaveBeenNthCalledWith(
      2,
      "/host",
      "kore-local",
      expect.anything(),
    );
  });

  it("releases the cluster lock and the lease when the cluster lock cannot be taken", async () => {
    const failure = systemError("EBUSY");
    vi.mocked(holdEnvironmentLock).mockReset();
    vi.mocked(holdEnvironmentLock)
      .mockResolvedValueOnce(lease)
      .mockRejectedValueOnce(failure);

    await expect(
      holdLiveLock({
        scope: async () => "kore-local",
        process: fakeProcess().hooks,
      }),
    ).rejects.toBe(failure);
    expect(lease.release).toHaveBeenCalledTimes(1);
  });
});

describe("holdLiveLock: releasing on exit", () => {
  it("releases both locks when the process exits", async () => {
    const proc = fakeProcess();
    await holdLiveLock({
      scope: async () => "kore-local",
      process: proc.hooks,
    });

    proc.fire("exit");

    expect(lock.releaseSync).toHaveBeenCalledTimes(1);
    expect(lease.releaseSync).toHaveBeenCalledTimes(1);
  });

  it("releases the locks on an interrupt, then exits 130 for SIGINT and 143 for SIGTERM", async () => {
    const proc = fakeProcess();
    await holdLiveLock({
      scope: async () => "kore-local",
      process: proc.hooks,
    });

    proc.fire("SIGINT");
    proc.fire("SIGTERM");

    expect(lock.releaseSync).toHaveBeenCalledTimes(2);
    expect(proc.hooks.exit.mock.calls).toEqual([[130], [143]]);
  });
});
