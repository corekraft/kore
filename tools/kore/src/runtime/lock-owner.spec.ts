import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { errorCode, processAlive, readLock, readOwner } from "./lock-owner.js";
import { systemError } from "./runtime-support.js";

vi.mock("node:fs/promises");

const LOCK = "/root/.kore/locks/local.lock";
const OWNER = {
  pid: 7,
  host: "box",
  token: "t-1",
  acquiredAt: "2026-01-01T00:00:00.000Z",
};

describe("processAlive", () => {
  it("reports a pid alive when signalling it with 0 succeeds", () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    expect(processAlive(7)).toBe(true);
    expect(kill).toHaveBeenCalledWith(7, 0);
  });

  it("reports a pid that belongs to someone else (EPERM) as alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("EPERM");
    });

    expect(processAlive(7)).toBe(true);
  });

  it("reports a pid that no longer exists (ESRCH) as not alive", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw systemError("ESRCH");
    });

    expect(processAlive(7)).toBe(false);
  });
});

describe("errorCode", () => {
  it("returns the code of a system error, and undefined for an error without one", () => {
    expect(errorCode(systemError("ENOENT"))).toBe("ENOENT");
    expect(errorCode(new Error("plain"))).toBeUndefined();
  });
});

describe("readLock", () => {
  it("reads the owner record from the lock file as UTF-8", async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(OWNER));

    await expect(readLock(LOCK)).resolves.toEqual(OWNER);
    expect(readFile).toHaveBeenCalledWith(LOCK, "utf8");
  });

  it("keeps a recorded worktree, and drops one that is not a string", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ ...OWNER, cwd: "/work" }),
    );
    await expect(readLock(LOCK)).resolves.toEqual({ ...OWNER, cwd: "/work" });

    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ ...OWNER, cwd: 5 }),
    );
    const owner = await readLock(LOCK);
    expect(owner).toEqual(OWNER);
    expect(owner).not.toHaveProperty("cwd");
  });

  it("treats malformed JSON, and a record missing or mistyping a field, as no owner", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("{not json");
    await expect(readLock(LOCK)).resolves.toBeUndefined();

    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ host: "box", token: "t-1", acquiredAt: "x" }),
    );
    await expect(readLock(LOCK)).resolves.toBeUndefined();

    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({ ...OWNER, pid: 1.5 }),
    );
    await expect(readLock(LOCK)).resolves.toBeUndefined();
  });

  it("reports a missing lock as gone, and a legacy directory lock as no owner", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(systemError("ENOENT"));
    await expect(readLock(LOCK)).resolves.toBe("gone");

    vi.mocked(readFile).mockRejectedValueOnce(systemError("EISDIR"));
    await expect(readLock(LOCK)).resolves.toBeUndefined();
  });

  it("rethrows any other read failure", async () => {
    const denied = systemError("EACCES");
    vi.mocked(readFile).mockRejectedValueOnce(denied);

    await expect(readLock(LOCK)).rejects.toBe(denied);
  });
});

describe("readOwner", () => {
  it("returns no owner when the lock is gone", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(systemError("ENOENT"));

    await expect(readOwner(LOCK)).resolves.toBeUndefined();
  });

  it("returns the owner of a lock that exists", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(OWNER));

    await expect(readOwner(LOCK)).resolves.toEqual(OWNER);
  });
});
