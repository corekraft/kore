import { describe, expect, it } from "vitest";
import {
  NOW,
  PATH,
  fakeClock,
  fakeFileSystem,
  withCode,
} from "./ledger-support.js";
import { STALE_LOCK_MS, acquire } from "./poll-lock.js";

const BUSY = {
  ok: false,
  message: `Another poll holds ${PATH}. Wait for it, or delete the file if no poll is running.`,
};

/** A lock file stamped `ageMs` before NOW. */
const stamped = (ageMs: number) =>
  new Date(Date.parse(NOW) - ageMs).toISOString();

/** The lock acquire returns when it is ok, so the tests can call refresh and release. */
async function take(fs: ReturnType<typeof fakeFileSystem>) {
  const held = await acquire(fs, fakeClock(), PATH);
  if (!held.ok) {
    throw new Error(held.message);
  }
  return held;
}

describe("acquire", () => {
  it("takes the lock by an exclusive create stamped with the clock", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockResolvedValue(undefined);
    const held = await acquire(fs, fakeClock(), PATH);
    expect(held.ok).toBe(true);
    expect(fs.createFile.mock.calls).toEqual([[PATH, NOW]]);
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("refresh restamps the held lock with the current time", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    const held = await take(fs);
    await held.refresh();
    expect(fs.writeFile.mock.calls).toEqual([[PATH, NOW]]);
  });

  it("release removes the lock file", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockResolvedValue(undefined);
    fs.remove.mockResolvedValue(undefined);
    const held = await take(fs);
    await held.release();
    expect(fs.remove.mock.calls).toEqual([[PATH]]);
  });
});

describe("acquire against a held lock", () => {
  it("reports busy with the path, and touches nothing, when a fresh lock is held", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockRejectedValue(withCode("EEXIST"));
    fs.readFile.mockResolvedValue(stamped(1000));
    expect(await acquire(fs, fakeClock(), PATH)).toEqual(BUSY);
    expect(fs.createFile).toHaveBeenCalledTimes(1);
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("keeps a lock exactly as old as the stale limit", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockRejectedValue(withCode("EEXIST"));
    fs.readFile.mockResolvedValue(stamped(STALE_LOCK_MS));
    expect(await acquire(fs, fakeClock(), PATH)).toEqual(BUSY);
    expect(fs.remove).not.toHaveBeenCalled();
  });

  it("takes over a lock older than the stale limit, removing it first", async () => {
    const fs = fakeFileSystem();
    fs.createFile
      .mockRejectedValueOnce(withCode("EEXIST"))
      .mockResolvedValueOnce(undefined);
    fs.readFile.mockResolvedValue(stamped(STALE_LOCK_MS + 1));
    fs.remove.mockResolvedValue(undefined);
    const held = await acquire(fs, fakeClock(), PATH);
    expect(held.ok).toBe(true);
    expect(fs.remove.mock.calls).toEqual([[PATH]]);
    expect(fs.createFile.mock.calls).toEqual([
      [PATH, NOW],
      [PATH, NOW],
    ]);
  });

  it("reports busy when another poll wins the takeover race", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockRejectedValue(withCode("EEXIST"));
    fs.readFile.mockResolvedValue(stamped(STALE_LOCK_MS + 1));
    fs.remove.mockResolvedValue(undefined);
    expect(await acquire(fs, fakeClock(), PATH)).toEqual(BUSY);
    expect(fs.createFile).toHaveBeenCalledTimes(2);
    expect(fs.remove.mock.calls).toEqual([[PATH]]);
  });

  it.each([
    ["an unreadable lock", () => Promise.reject(withCode("ENOENT"))],
    ["a lock with no timestamp", () => Promise.resolve("not a time")],
  ])("treats %s as stale, since it cannot be aged", async (_, read) => {
    const fs = fakeFileSystem();
    fs.createFile
      .mockRejectedValueOnce(withCode("EEXIST"))
      .mockResolvedValueOnce(undefined);
    fs.readFile.mockImplementation(read);
    fs.remove.mockResolvedValue(undefined);
    expect((await acquire(fs, fakeClock(), PATH)).ok).toBe(true);
    expect(fs.remove.mock.calls).toEqual([[PATH]]);
  });

  it("rethrows a create error other than an existing file, and reads nothing", async () => {
    const fs = fakeFileSystem();
    fs.createFile.mockRejectedValue(withCode("EACCES", "denied"));
    await expect(acquire(fs, fakeClock(), PATH)).rejects.toThrow("denied");
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.remove).not.toHaveBeenCalled();
  });
});
