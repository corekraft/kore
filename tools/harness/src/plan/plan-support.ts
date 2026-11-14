import { vi } from "vitest";
import type { CliDeps, FileSystem, Runner } from "../runtime/index.js";

export const ROOT = "/repo";

/** A file system whose every method is a typed mock; a spec sets the answers it needs. */
export function fakeFileSystem(): FileSystem {
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
export function fakeDeps(): CliDeps {
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
