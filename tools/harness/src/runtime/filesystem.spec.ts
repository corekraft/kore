import {
  appendFile,
  glob,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nodeFileSystem } from "./filesystem.js";
import {
  asFileHandle,
  asGlob,
  errnoError,
  fakeHandle,
  fakeStats,
} from "./filesystem-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

describe("nodeFileSystem: reading and writing whole files", () => {
  it("reads a file as UTF-8 text", async () => {
    vi.mocked(readFile).mockResolvedValue("text");
    expect(await nodeFileSystem.readFile("/r/a.txt")).toBe("text");
    expect(vi.mocked(readFile).mock.calls).toEqual([["/r/a.txt", "utf8"]]);
  });

  it("writes a file after creating its missing parent directories", async () => {
    vi.mocked(dirname).mockReturnValue("/r/d");
    await nodeFileSystem.writeFile("/r/d/a.txt", "x");
    expect(vi.mocked(mkdir).mock.calls).toEqual([
      ["/r/d", { recursive: true }],
    ]);
    expect(vi.mocked(writeFile).mock.calls).toEqual([["/r/d/a.txt", "x"]]);
    expect(vi.mocked(mkdir).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFile).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("creates a file exclusively with the wx flag, and rejects an existing one with its code", async () => {
    vi.mocked(dirname).mockReturnValue("/r/d");
    await nodeFileSystem.createFile("/r/d/a.txt", "first");
    expect(vi.mocked(writeFile).mock.calls).toEqual([
      ["/r/d/a.txt", "first", { flag: "wx" }],
    ]);
    vi.mocked(writeFile).mockRejectedValue(errnoError("EEXIST"));
    await expect(
      nodeFileSystem.createFile("/r/d/a.txt", "second"),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("appends after creating the missing parent directories", async () => {
    vi.mocked(dirname).mockReturnValue("/r/logs");
    await nodeFileSystem.appendFile("/r/logs/log.jsonl", "one\n");
    expect(vi.mocked(mkdir).mock.calls).toEqual([
      ["/r/logs", { recursive: true }],
    ]);
    expect(vi.mocked(appendFile).mock.calls).toEqual([
      ["/r/logs/log.jsonl", "one\n"],
    ]);
  });
});

describe("nodeFileSystem: existence and kind", () => {
  it("is true for a present path, false for a missing one, and rethrows any other stat failure", async () => {
    vi.mocked(stat).mockResolvedValueOnce(fakeStats());
    expect(await nodeFileSystem.exists("/r/a")).toBe(true);
    vi.mocked(stat).mockRejectedValueOnce(errnoError("ENOENT"));
    expect(await nodeFileSystem.exists("/r/none")).toBe(false);
    vi.mocked(stat).mockRejectedValueOnce(errnoError("EACCES"));
    await expect(nodeFileSystem.exists("/r/locked")).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("is true for a directory and false for a file", async () => {
    vi.mocked(stat).mockResolvedValueOnce(fakeStats({ directory: true }));
    expect(await nodeFileSystem.isDirectory("/r/sub")).toBe(true);
    vi.mocked(stat).mockResolvedValueOnce(fakeStats({ directory: false }));
    expect(await nodeFileSystem.isDirectory("/r/file")).toBe(false);
  });

  it("is false for a missing path, and rethrows any other stat failure", async () => {
    vi.mocked(stat).mockRejectedValueOnce(errnoError("ENOENT"));
    expect(await nodeFileSystem.isDirectory("/r/none")).toBe(false);
    vi.mocked(stat).mockRejectedValueOnce(errnoError("ENOTDIR"));
    await expect(
      nodeFileSystem.isDirectory("/r/f/child"),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("nodeFileSystem: directories, links and removal", () => {
  it("lists a directory's entries by name", async () => {
    vi.mocked(readdir).mockResolvedValue(["a.yaml"] as never);
    expect(await nodeFileSystem.readdir("/r")).toEqual(["a.yaml"]);
    expect(vi.mocked(readdir).mock.calls).toEqual([["/r"]]);
  });

  it("removes a file forcibly, so an already-missing file succeeds", async () => {
    await nodeFileSystem.remove("/r/a");
    expect(vi.mocked(rm).mock.calls).toEqual([["/r/a", { force: true }]]);
  });

  it("returns a link's target as written", async () => {
    vi.mocked(readlink).mockResolvedValue("../target");
    expect(await nodeFileSystem.readlink("/r/link")).toBe("../target");
    expect(vi.mocked(readlink).mock.calls).toEqual([["/r/link"]]);
  });

  it("returns the modification time in epoch milliseconds", async () => {
    vi.mocked(stat).mockResolvedValue(fakeStats({ mtimeMs: 42 }));
    expect(await nodeFileSystem.mtimeMs("/r/a")).toBe(42);
    expect(vi.mocked(stat).mock.calls).toEqual([["/r/a"]]);
  });
});

describe("nodeFileSystem: reading part of a file", () => {
  it("reads only the first bytes, then closes the handle", async () => {
    const handle = fakeHandle("abcdefghij");
    vi.mocked(open).mockResolvedValue(asFileHandle(handle));
    expect(await nodeFileSystem.readHead("/r/big.txt", 4)).toBe("abcd");
    expect(vi.mocked(open).mock.calls).toEqual([["/r/big.txt", "r"]]);
    expect(handle.read.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 4, 0],
    ]);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("closes the handle even when the read fails", async () => {
    const handle = fakeHandle("abc");
    handle.read.mockRejectedValue(errnoError("EIO"));
    vi.mocked(open).mockResolvedValue(asFileHandle(handle));
    await expect(nodeFileSystem.readHead("/r/a", 4)).rejects.toMatchObject({
      code: "EIO",
    });
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("reads from a byte offset to the end, without reading what precedes it", async () => {
    const handle = fakeHandle("abcdefghij");
    vi.mocked(open).mockResolvedValue(asFileHandle(handle));
    expect(await nodeFileSystem.readFrom("/r/log.txt", 6)).toBe("ghij");
    expect(handle.read.mock.calls.map((call) => call.slice(1))).toEqual([
      [0, 4, 6],
    ]);
    expect(handle.close).toHaveBeenCalledTimes(1);
  });

  it("returns empty at or past the end, without reading", async () => {
    const handle = fakeHandle("abcdefghij");
    vi.mocked(open).mockResolvedValue(asFileHandle(handle));
    expect(await nodeFileSystem.readFrom("/r/log.txt", 10)).toBe("");
    expect(await nodeFileSystem.readFrom("/r/log.txt", 500)).toBe("");
    expect(handle.read).not.toHaveBeenCalled();
  });
});

describe("nodeFileSystem.hasGlobMatch", () => {
  /** A walk that yields `paths` and counts how many the caller pulled. */
  function walk(paths: string[]) {
    const pulled = { count: 0 };
    async function* generator() {
      for (const path of paths) {
        pulled.count++;
        yield path;
      }
    }
    vi.mocked(glob).mockReturnValue(asGlob(generator()));
    return pulled;
  }

  it("is true when a path matches, and stops walking at the first one", async () => {
    const pulled = walk(["a.yaml", "b.yaml", "c.yaml"]);
    expect(await nodeFileSystem.hasGlobMatch("/repo", "*.yaml")).toBe(true);
    expect(pulled.count).toBe(1);
  });

  it("is false when no path matches, so the glob is unmatched", async () => {
    walk([]);
    expect(await nodeFileSystem.hasGlobMatch("/repo", "*.zzz")).toBe(false);
  });

  it("walks from the given directory and never enters node_modules or .git", async () => {
    walk([]);
    await nodeFileSystem.hasGlobMatch("/repo/wt", "*.yaml");
    expect(vi.mocked(glob).mock.calls).toEqual([
      ["*.yaml", { cwd: "/repo/wt", exclude: ["**/node_modules", "**/.git"] }],
    ]);
  });
});
