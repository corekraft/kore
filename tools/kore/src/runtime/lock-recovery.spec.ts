import { open, rm, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, readLock, type LockOwner } from "./lock-owner.js";
import {
  judge,
  recover,
  refusal,
  type LockPaths,
  type LockProbes,
} from "./lock-recovery.js";
import { fakeHandle, systemError } from "./runtime-support.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("./lock-owner.js");

const LOCK = "/root/.kore/locks/local.lock";
const PATHS: LockPaths = { lock: LOCK, recovery: `${LOCK}.recovery` };
const OWNER: LockOwner = {
  pid: 7,
  host: "box",
  token: "t-1",
  acquiredAt: "2026-01-01T01:00:00.000Z",
};

function probes(overrides: Partial<LockProbes> = {}): LockProbes {
  return { isAlive: () => true, bootTime: () => 0, ...overrides };
}

beforeEach(() => {
  vi.mocked(hostname).mockReturnValue("box");
  vi.mocked(errorCode).mockImplementation(
    (error) => (error as NodeJS.ErrnoException).code,
  );
  vi.mocked(readLock).mockResolvedValue(OWNER);
});

describe("judge", () => {
  it("reports a lock that vanished since the failed attempt as gone, to retry", async () => {
    vi.mocked(readLock).mockResolvedValue("gone");

    await expect(judge(LOCK, probes())).resolves.toEqual({
      dead: false,
      reason: "the lock was released while it was being inspected",
      fix: "Retry.",
      gone: true,
    });
  });

  it("refuses a lock with no readable owner, with the manual removal command", async () => {
    vi.mocked(readLock).mockResolvedValue(undefined);

    await expect(judge(LOCK, probes())).resolves.toEqual({
      dead: false,
      reason: "its owner is unknown (legacy or malformed lock)",
      fix: `If no kore process is running, remove it with: rm -rf ${LOCK}`,
    });
  });

  it("refuses a lock held on another host, since its pid cannot be checked from here", async () => {
    vi.mocked(readLock).mockResolvedValue({ ...OWNER, host: "other" });

    await expect(judge(LOCK, probes())).resolves.toMatchObject({
      dead: false,
      reason: "held by pid 7 on host other, which cannot be checked from here",
    });
  });

  it("waits for a live owner on this host", async () => {
    await expect(judge(LOCK, probes())).resolves.toEqual({
      dead: false,
      reason: "held by running pid 7",
      fix: "Wait for it to finish, or stop that process.",
      live: true,
    });
  });

  it("treats an owner whose pid is gone as dead, and returns that owner", async () => {
    await expect(
      judge(LOCK, probes({ isAlive: () => false })),
    ).resolves.toEqual({ dead: true, owner: OWNER });
  });

  it("treats a live pid as dead when the lock predates the host's boot, since the pid was reused", async () => {
    const acquired = Date.parse(OWNER.acquiredAt);

    await expect(
      judge(LOCK, probes({ bootTime: () => acquired + 120_000 })),
    ).resolves.toEqual({ dead: true, owner: OWNER });
  });

  it("does not take a clock gap under a minute as proof of a reboot", async () => {
    const acquired = Date.parse(OWNER.acquiredAt);

    await expect(
      judge(LOCK, probes({ bootTime: () => acquired + 30_000 })),
    ).resolves.toMatchObject({ dead: false, live: true });
  });
});

describe("recover", () => {
  it("leaves the lock alone when another process holds the recovery lock", async () => {
    vi.mocked(open).mockRejectedValue(systemError("EEXIST"));

    await expect(recover(PATHS, probes())).resolves.toBeUndefined();
    expect(unlink).not.toHaveBeenCalled();
    expect(rm).not.toHaveBeenCalled();
  });

  it("rethrows a failure to take the recovery lock that is not an existing one", async () => {
    const denied = systemError("EACCES");
    vi.mocked(open).mockRejectedValue(denied);

    await expect(recover(PATHS, probes())).rejects.toBe(denied);
  });

  it("removes nothing when the lock changed hands while it was inspected", async () => {
    const fake = fakeHandle();
    vi.mocked(open).mockResolvedValue(fake.handle);
    vi.mocked(readLock).mockResolvedValue({ ...OWNER, pid: 9 });

    await expect(recover(PATHS, probes())).resolves.toBeUndefined();
    expect(unlink).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(PATHS.recovery, { force: true });
  });

  it("removes a dead owner's lock, returns that owner, and releases the recovery lock", async () => {
    const fake = fakeHandle();
    vi.mocked(open).mockResolvedValue(fake.handle);

    await expect(
      recover(PATHS, probes({ isAlive: () => false })),
    ).resolves.toEqual(OWNER);
    expect(unlink).toHaveBeenCalledWith(LOCK);
    expect(fake.close).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(PATHS.recovery, { force: true });
  });

  it("releases the recovery lock even when removing the stale lock fails", async () => {
    const fake = fakeHandle();
    const failure = systemError("EPERM");
    vi.mocked(open).mockResolvedValue(fake.handle);
    vi.mocked(unlink).mockRejectedValue(failure);

    await expect(recover(PATHS, probes({ isAlive: () => false }))).rejects.toBe(
      failure,
    );
    expect(fake.close).toHaveBeenCalled();
    expect(rm).toHaveBeenCalledWith(PATHS.recovery, { force: true });
  });
});

describe("refusal", () => {
  it("names the environment, the lock, what blocks it, and the fix", () => {
    expect(
      refusal("local", LOCK, "held by running pid 7", "Wait.").message,
    ).toBe(
      `another mutation is already running for environment local: held by running pid 7 (lock ${LOCK}). Wait.`,
    );
  });
});
