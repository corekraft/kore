// Fakes the prompt-size units share (#1038). Not a unit, so it has no spec of its own (ADR 0098).
// Every fake is a typed object whose methods are vi.fn spies, so a spec sets the behaviour it
// needs and asserts the whole call list. No casts: each type is the real one, with spies.
import { vi, type Mock } from "vitest";
import type {
  CliDeps,
  Clock,
  CommandContext,
  FileSystem,
  IdSource,
  Runner,
} from "../runtime/index.js";

/** Every FileSystem method as a spy, so an unstubbed call returns undefined and fails the spec. */
export type FakeFileSystem = { [K in keyof FileSystem]: Mock<FileSystem[K]> };

export function fakeFileSystem(): FakeFileSystem {
  return {
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
    hasGlobMatch: vi.fn<FileSystem["hasGlobMatch"]>(),
  };
}

export type FakeClock = {
  now: Mock<Clock["now"]>;
  sleep: Mock<Clock["sleep"]>;
};

/** A clock fixed at 2026-01-02T03:04:05Z; sleeping advances it instead of waiting. */
export function fakeClock(): FakeClock {
  let elapsed = 0;
  return {
    now: vi.fn<Clock["now"]>(
      () => new Date(Date.parse("2026-01-02T03:04:05.000Z") + elapsed),
    ),
    sleep: vi.fn<Clock["sleep"]>((ms: number) => {
      elapsed += ms;
      return Promise.resolve();
    }),
  };
}

/** Everything a prompt-size command may touch, as spies; the repository root resolves to /repo. */
export interface FakeDeps {
  runner: { run: Mock<Runner["run"]> };
  clock: FakeClock;
  fs: FakeFileSystem;
  root: Mock<CliDeps["root"]>;
  ids: { next: Mock<IdSource["next"]> };
  env: Record<string, string | undefined>;
  cwd: string;
  stdin: Mock<CliDeps["stdin"]>;
  stdout: Mock<CliDeps["stdout"]>;
  stderr: Mock<CliDeps["stderr"]>;
}

export function fakeDeps(): FakeDeps {
  return {
    runner: { run: vi.fn<Runner["run"]>() },
    clock: fakeClock(),
    fs: fakeFileSystem(),
    root: vi.fn<CliDeps["root"]>(() => Promise.resolve("/repo")),
    ids: { next: vi.fn<IdSource["next"]>(() => "id-1") },
    env: {},
    cwd: "/repo",
    stdin: vi.fn<CliDeps["stdin"]>(() => Promise.resolve("")),
    stdout: vi.fn<CliDeps["stdout"]>(),
    stderr: vi.fn<CliDeps["stderr"]>(),
  };
}

/** A command context over the fake deps; a spec overrides only what it reads. */
export function contextOf(
  deps: FakeDeps,
  over: Partial<Omit<CommandContext, "deps">> = {},
): CommandContext {
  return { json: false, options: {}, deps, ...over };
}
