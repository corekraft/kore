import { describe, expect, it, vi } from "vitest";
import { RulesetError } from "./declared.js";
import { withLock } from "./lock.js";
import { NOW, ROOT, fakeDeps } from "./ruleset-support.js";

const LOCK = `${ROOT}/.kore/state/locks/ruleset-corekraft-kore.lock`;
const SINCE = JSON.stringify({ since: NOW });
const heldElsewhere = Object.assign(new Error("exists"), { code: "EEXIST" });

describe("withLock creates the repository's lock file exclusively", () => {
  it("creates the lock named after the repository, stamped with the clock's time", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockResolvedValue(undefined);
    await withLock(deps, "corekraft/kore", () => Promise.resolve(1));
    expect(deps.fs.createFile.mock.calls).toEqual([[LOCK, SINCE]]);
  });

  it("replaces every character outside letters, digits, dot, underscore and dash in the name", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockResolvedValue(undefined);
    await withLock(deps, "a/b c", () => Promise.resolve(null));
    expect(deps.fs.createFile.mock.calls[0]?.[0]).toBe(
      `${ROOT}/.kore/state/locks/ruleset-a-b-c.lock`,
    );
  });
});

describe("withLock runs the action under the lock and returns its result", () => {
  it("returns the action's value and removes the lock afterwards", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockResolvedValue(undefined);
    deps.fs.remove.mockResolvedValue(undefined);
    const action = vi.fn(() => Promise.resolve("saved"));
    expect(await withLock(deps, "corekraft/kore", action)).toBe("saved");
    expect(action).toHaveBeenCalledTimes(1);
    expect(deps.fs.remove.mock.calls).toEqual([[LOCK]]);
  });

  it("removes the lock and rethrows when the action fails", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockResolvedValue(undefined);
    deps.fs.remove.mockResolvedValue(undefined);
    const failure = new Error("save failed");
    await expect(
      withLock(deps, "corekraft/kore", () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(deps.fs.remove.mock.calls).toEqual([[LOCK]]);
  });
});

describe("withLock refuses to run beside another sync", () => {
  it("names the lock file and skips the action when another sync holds it", async () => {
    const deps = fakeDeps();
    deps.fs.createFile.mockRejectedValue(heldElsewhere);
    const action = vi.fn(() => Promise.resolve(1));
    const failed = withLock(deps, "corekraft/kore", action);
    await expect(failed).rejects.toThrow(RulesetError);
    await expect(failed).rejects.toThrow(
      `Another ruleset sync holds the lock for corekraft/kore: ${LOCK}. Wait for it to finish, then rerun. If no sync is running, delete that file, then rerun.`,
    );
    expect(action).not.toHaveBeenCalled();
    expect(deps.fs.remove).not.toHaveBeenCalled();
  });

  it("rethrows a failure to create the lock that is not a held lock, and runs nothing", async () => {
    const deps = fakeDeps();
    const disk = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    deps.fs.createFile.mockRejectedValue(disk);
    const action = vi.fn(() => Promise.resolve(1));
    await expect(withLock(deps, "corekraft/kore", action)).rejects.toBe(disk);
    expect(action).not.toHaveBeenCalled();
    expect(deps.fs.remove).not.toHaveBeenCalled();
  });
});
