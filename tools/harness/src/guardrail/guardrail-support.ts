// Fakes for the guardrail unit specs: typed collaborators whose members are vi.fn
// mocks, with no behaviour of their own. A support file is not a unit (ADR 0098).
import { vi } from "vitest";
import type {
  CliDeps,
  Clock,
  FileSystem,
  IdSource,
  Runner,
} from "../runtime/index.js";

/**
 * A file system whose every method is a mock. The two a spec replies to or
 * asserts on are also returned as standalone mocks, so a spec never references
 * an interface method.
 */
export function fakeFileSystem() {
  const readFile = vi.fn<FileSystem["readFile"]>();
  const writeFile = vi.fn<FileSystem["writeFile"]>();
  const fs: FileSystem = {
    readFile,
    writeFile,
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
    hasGlobMatch: vi.fn<FileSystem["hasGlobMatch"]>(),
  };
  return { fs, readFile, writeFile };
}

/**
 * Command deps with every member a mock. The repository root resolves to
 * /repo, the working directory is /work/tree, and the environment is empty.
 */
export function fakeDeps() {
  const { fs, readFile, writeFile } = fakeFileSystem();
  const runner: Runner = { run: vi.fn<Runner["run"]>() };
  const clock: Clock = {
    now: vi.fn<Clock["now"]>(),
    sleep: vi.fn<Clock["sleep"]>(),
  };
  const ids: IdSource = { next: vi.fn<IdSource["next"]>() };
  const root = vi.fn<CliDeps["root"]>().mockResolvedValue("/repo");
  const stdin = vi.fn<CliDeps["stdin"]>().mockResolvedValue("");
  const stdout = vi.fn<CliDeps["stdout"]>();
  const stderr = vi.fn<CliDeps["stderr"]>();
  const deps: CliDeps = {
    runner,
    clock,
    fs,
    root,
    ids,
    env: {},
    cwd: "/work/tree",
    stdin,
    stdout,
    stderr,
  };
  return { deps, readFile, writeFile, stdout, stderr, root };
}
