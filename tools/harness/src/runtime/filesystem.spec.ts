import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFileSystem } from "./filesystem.js";
import { MemoryFileSystem, RootedMemoryFileSystem } from "../testing/index.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "kore-fs-"));
  temps.push(dir);
  return dir;
}

describe("nodeFileSystem", () => {
  it("reads only the first bytes of a file", async () => {
    const file = join(temp(), "big.txt");
    writeFileSync(file, "abcdefghij");
    expect(await nodeFileSystem.readHead(file, 4)).toBe("abcd");
    expect(await nodeFileSystem.readHead(file, 100)).toBe("abcdefghij");
  });

  it("reads a file from a byte offset without reading what precedes it", async () => {
    const file = join(temp(), "log.txt");
    writeFileSync(file, "abcdéfghij");
    expect(await nodeFileSystem.readFrom(file, 0)).toBe("abcdéfghij");
    expect(await nodeFileSystem.readFrom(file, 6)).toBe("fghij");
    expect(await nodeFileSystem.readFrom(file, 11)).toBe("");
    expect(await nodeFileSystem.readFrom(file, 500)).toBe("");
  });

  it("rejects reading the head of a missing file", async () => {
    await expect(
      nodeFileSystem.readHead(join(temp(), "none"), 4),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("tells directories from files and missing paths", async () => {
    const dir = temp();
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "file"), "x");
    expect(await nodeFileSystem.isDirectory(join(dir, "sub"))).toBe(true);
    expect(await nodeFileSystem.isDirectory(join(dir, "file"))).toBe(false);
    expect(await nodeFileSystem.isDirectory(join(dir, "none"))).toBe(false);
  });

  it("rethrows a stat failure other than a missing path", async () => {
    const file = join(temp(), "file");
    writeFileSync(file, "x");
    await expect(
      nodeFileSystem.isDirectory(join(file, "child")),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("in-memory file systems", () => {
  it("slice the head and report implied directories", async () => {
    for (const fs of [
      new MemoryFileSystem(),
      new RootedMemoryFileSystem("/r"),
    ]) {
      await fs.writeFile("/r/dir/file", "abcdef");
      expect(await fs.readHead("/r/dir/file", 3)).toBe("abc");
      expect(await fs.isDirectory("/r/dir")).toBe(true);
      expect(await fs.isDirectory("/r/dir/file")).toBe(false);
    }
  });
});
