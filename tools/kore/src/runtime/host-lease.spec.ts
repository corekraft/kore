import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { HOST_LEASE, holdsHostLease, withHostLease } from "./host-lease.js";
import { hostRoot } from "./host-locks.js";
import { readOwner, type LockOwner } from "./lock-owner.js";
import { inheritsLock, withEnvironmentLock } from "./lock.js";

// Docs: docs/decisions/0002-tool-responsibility-boundaries.md

vi.mock("node:path");
vi.mock("./host-locks.js");
vi.mock("./lock-owner.js");
vi.mock("./lock.js");

const LOCK = "/host/.kore/locks/host-lease.lock";

/** A lock owner record held by `pid`. */
function owner(pid: number): LockOwner {
  return {
    pid,
    host: "host",
    token: "token",
    acquiredAt: "2026-11-07T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(hostRoot).mockReturnValue("/host");
});

test("withHostLease runs its operation under the host lease, in the host lock directory", async () => {
  const operation = vi.fn(async () => "done");
  vi.mocked(withEnvironmentLock).mockImplementation(
    async (_root, _name, work) => await work(),
  );
  await expect(withHostLease(operation)).resolves.toBe("done");
  expect(operation).toHaveBeenCalledOnce();
  expect(vi.mocked(withEnvironmentLock).mock.calls).toEqual([
    ["/host", HOST_LEASE, operation, {}],
  ]);
});

test("withHostLease hands its lock options to the lock unchanged", async () => {
  const operation = async () => "done";
  await withHostLease(operation, { waitMs: 5000 });
  expect(vi.mocked(withEnvironmentLock).mock.calls).toEqual([
    ["/host", HOST_LEASE, operation, { waitMs: 5000 }],
  ]);
});

test("holdsHostLease is true for a process that inherited the lease, without reading the owner", async () => {
  vi.mocked(inheritsLock).mockResolvedValue(true);
  expect(await holdsHostLease()).toBe(true);
  expect(vi.mocked(inheritsLock).mock.calls).toEqual([[LOCK, HOST_LEASE]]);
  expect(vi.mocked(readOwner)).not.toHaveBeenCalled();
});

test("holdsHostLease is true when this process wrote the lease's owner record", async () => {
  vi.mocked(inheritsLock).mockResolvedValue(false);
  vi.mocked(readOwner).mockResolvedValue(owner(process.pid));
  expect(await holdsHostLease()).toBe(true);
  expect(vi.mocked(readOwner).mock.calls).toEqual([[LOCK]]);
});

test("holdsHostLease is false when another process holds the lease or nobody does", async () => {
  vi.mocked(inheritsLock).mockResolvedValue(false);
  vi.mocked(readOwner).mockResolvedValue(owner(process.pid + 1));
  expect(await holdsHostLease()).toBe(false);
  vi.mocked(readOwner).mockResolvedValue(undefined);
  expect(await holdsHostLease()).toBe(false);
});
