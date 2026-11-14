import { vi, type Mock } from "vitest";
import type { CliDeps, Clock, FileSystem, Runner } from "../runtime/index.js";

export const ROOT = "/repo";

/**
 * A file system whose every member is a typed mock property (not a method),
 * so a spec can read and assert on each one; it answers nothing until a spec sets it.
 */
export type FakeFileSystem = { [K in keyof FileSystem]: Mock<FileSystem[K]> };

/** The dependencies a plan command reads, with each one a typed mock property. */
export type FakeDeps = Omit<
  CliDeps,
  "fs" | "root" | "stdout" | "stderr" | "stdin" | "clock"
> & {
  fs: FakeFileSystem;
  root: Mock<CliDeps["root"]>;
  stdout: Mock<CliDeps["stdout"]>;
  stderr: Mock<CliDeps["stderr"]>;
  stdin: Mock<CliDeps["stdin"]>;
  clock: { now: Mock<Clock["now"]>; sleep: Mock<Clock["sleep"]> };
  runner: { run: Mock<Runner["run"]> };
};

export function fakeFileSystem(): FakeFileSystem {
  return {
    hasGlobMatch: vi.fn<FileSystem["hasGlobMatch"]>(),
    readFile: vi.fn<FileSystem["readFile"]>(),
    writeFile: vi.fn<FileSystem["writeFile"]>(),
    createFile: vi.fn<FileSystem["createFile"]>(),
    appendFile: vi.fn<FileSystem["appendFile"]>(),
    exists: vi.fn<FileSystem["exists"]>(),
    readdir: vi.fn<FileSystem["readdir"]>(),
    remove: vi.fn<FileSystem["remove"]>(),
    readlink: vi.fn<FileSystem["readlink"]>(),
    mtimeMs: vi.fn<FileSystem["mtimeMs"]>(),
    isDirectory: vi.fn<FileSystem["isDirectory"]>(),
    readHead: vi.fn<FileSystem["readHead"]>(),
    readFrom: vi.fn<FileSystem["readFrom"]>(),
  };
}

/** Every dependency a plan command reads, as typed mocks. Build one per test. */
export function fakeDeps(): FakeDeps {
  return {
    runner: { run: vi.fn<Runner["run"]>() },
    clock: {
      now: vi.fn(() => new Date("2026-01-02T12:00:00.000Z")),
      sleep: vi.fn(() => Promise.resolve()),
    },
    fs: fakeFileSystem(),
    root: vi.fn(() => Promise.resolve(ROOT)),
    ids: { next: vi.fn(() => "id-1") },
    env: {},
    cwd: ROOT,
    stdin: vi.fn(() => Promise.resolve("")),
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  };
}
