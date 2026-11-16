import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { FileLeaseStore } from "./tick-lease-store.js";

const PATH = "/host/.kore/locks/orchestrate-tick.lock";
const RECORD = {
  token: "t",
  pid: 1,
  host: "h",
  acquiredAt: "2026-11-16T12:00:00.000Z",
};

type FakeFs = Record<
  "createFile" | "writeFile" | "readFile" | "exists" | "remove",
  ReturnType<typeof vi.fn>
>;

const fakeFs = (over: Partial<FakeFs> = {}): FakeFs =>
  ({
    createFile: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(JSON.stringify(RECORD)),
    exists: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  }) as unknown as FakeFs;

const make = (fs: FakeFs) =>
  new FileLeaseStore(fs as unknown as FileSystem, PATH);

describe("FileLeaseStore", () => {
  it("creates the lease file exclusively, so a second tick cannot also create it", async () => {
    const fs = fakeFs();

    expect(await make(fs).create(RECORD)).toBe(true);
    expect(fs.createFile).toHaveBeenCalledWith(
      PATH,
      `${JSON.stringify(RECORD)}\n`,
    );
  });

  it("reports an existing lease file as not created", async () => {
    const fs = fakeFs({
      createFile: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("x"), { code: "EEXIST" })),
    });

    expect(await make(fs).create(RECORD)).toBe(false);
  });

  it("rethrows a create failure that is not an existing file", async () => {
    const fs = fakeFs({
      createFile: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("denied"), { code: "EACCES" }),
        ),
    });

    await expect(make(fs).create(RECORD)).rejects.toThrow("denied");
  });

  it("overwrites and removes the lease file", async () => {
    const fs = fakeFs();
    const store = make(fs);

    await store.overwrite(RECORD);
    await store.remove();

    expect(fs.writeFile).toHaveBeenCalledWith(
      PATH,
      `${JSON.stringify(RECORD)}\n`,
    );
    expect(fs.remove).toHaveBeenCalledWith(PATH);
  });

  it("reads the record, and nothing when there is no file", async () => {
    expect(await make(fakeFs()).read()).toEqual(RECORD);
    expect(
      await make(fakeFs({ exists: vi.fn().mockResolvedValue(false) })).read(),
    ).toBeUndefined();
  });

  it("fails closed, naming the file to remove, when the lease cannot be parsed", async () => {
    const fs = fakeFs({ readFile: vi.fn().mockResolvedValue("not json") });

    await expect(make(fs).read()).rejects.toThrow(
      `${PATH} is not a tick lease; if no tick is running, remove it, then rerun.`,
    );
  });
});
