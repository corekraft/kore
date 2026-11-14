// Fakes and fixtures the idea unit specs share. Not a unit, so it has no spec of
// its own. Every fake is a typed object whose methods are vi.fn spies, so a spec
// sets the behaviour it needs and asserts the whole call list.
import { vi, type Mock } from "vitest";
import type {
  CliDeps,
  Clock,
  FileSystem,
  IdSource,
  Runner,
} from "../runtime/index.js";
import type { IdeaRecord } from "./record.js";
import type { IdeaRepository } from "./repository.js";

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

/** A clock fixed on 2026-03-04 UTC; sleep is a spy, so no real timer runs. */
export function fakeClock(): {
  now: Mock<Clock["now"]>;
  sleep: Mock<Clock["sleep"]>;
} {
  return {
    now: vi.fn<Clock["now"]>(() => new Date("2026-03-04T00:00:00.000Z")),
    sleep: vi.fn<Clock["sleep"]>(() => Promise.resolve()),
  };
}

export type FakeRunner = { run: Mock<Runner["run"]> };

/** A process runner whose calls the spec answers one by one. */
export function fakeRunner(): FakeRunner {
  return { run: vi.fn<Runner["run"]>() };
}

export type FakeRepository = {
  [
    K in "list" | "get" | "create" | "source" | "recordIssue" | "recordOutcome"
  ]: Mock<IdeaRepository[K]>;
};

/** Every IdeaRepository method a command calls, as spies. */
export function fakeRepository(): FakeRepository {
  return {
    list: vi.fn<IdeaRepository["list"]>(),
    get: vi.fn<IdeaRepository["get"]>(),
    create: vi.fn<IdeaRepository["create"]>(),
    source: vi.fn<IdeaRepository["source"]>(),
    recordIssue: vi.fn<IdeaRepository["recordIssue"]>(),
    recordOutcome: vi.fn<IdeaRepository["recordOutcome"]>(),
  };
}

/**
 * The repository fake as the class a constructor returns. The fake carries only
 * the methods commands call, so this is the one cast a spec needs.
 */
export function asRepository(fake: FakeRepository): IdeaRepository {
  return fake as unknown as IdeaRepository;
}

export interface FakeDeps {
  runner: FakeRunner;
  clock: ReturnType<typeof fakeClock>;
  fs: FakeFileSystem;
  root: Mock<CliDeps["root"]>;
  ids: { next: Mock<IdSource["next"]> };
  env: Record<string, string | undefined>;
  cwd: string;
  stdin: Mock<CliDeps["stdin"]>;
  stdout: Mock<CliDeps["stdout"]>;
  stderr: Mock<CliDeps["stderr"]>;
}

/** Everything a command may touch, as spies; the repository root resolves to /repo. */
export function fakeDeps(): FakeDeps {
  return {
    runner: fakeRunner(),
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

/** A complete idea record, as parseIdea builds one; a spec overrides only the fields it asserts on. */
export function recordFixture(over: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    number: "0001",
    slug: "cache-the-probe-results",
    path: "docs/ideas/0001-cache-the-probe-results.md",
    title: "Cache the probe results",
    summary: "Cache the probe results",
    hypothesis: "Caching probes cuts up time.",
    expectedOutcome: "Up time drops by 20 percent.",
    measurement: "Compare kore local up duration in the ledger.",
    safetyPattern: "feature-flagged",
    date: "2026-03-04",
    ...over,
  };
}
