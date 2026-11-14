// Typed fakes and fixtures the ledger domain's unit specs share. Each is a
// `vi.fn` per member of the interface it stands in for, so a spec asserts the
// calls it made. Not a unit, so no spec of its own (ADR 0098).
import { vi, type Mock } from "vitest";
import type {
  Clock,
  FileSystem,
  IdSource,
  RunResult,
  Runner,
} from "../runtime/index.js";
import type { Ledger, RecordResult } from "./ledger.js";
import type { EventInput } from "./schema.js";

export const PATH = "/repo/.kore/state/ledger.jsonl";
export const NOW = "2026-01-02T03:00:00.000Z";

export type FakeRunner = { run: Mock<Runner["run"]> };

export function fakeRunner(): FakeRunner {
  return { run: vi.fn<Runner["run"]>() };
}

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

export interface FakeClock {
  now: Mock<Clock["now"]>;
  sleep: Mock<Clock["sleep"]>;
}

/** A clock that always reads `at`; nothing waits on it. */
export function fakeClock(at = NOW): FakeClock {
  return {
    now: vi.fn<Clock["now"]>(() => new Date(at)),
    sleep: vi.fn<Clock["sleep"]>(),
  };
}

export function fakeIds(first = "id-1"): { next: Mock<IdSource["next"]> } {
  return { next: vi.fn<IdSource["next"]>(() => first) };
}

export interface FakeLedger {
  ledger: Ledger;
  list: Mock<Ledger["list"]>;
  /** Typed by the event the pollers hand it, so a spec reads each recorded input's fields. */
  record: Mock<(input: EventInput) => Promise<RecordResult>>;
}

/** The ledger's public surface; the class's private fields are not modelled. */
export function fakeLedger(): FakeLedger {
  const list = vi.fn<Ledger["list"]>();
  const record = vi.fn<(input: EventInput) => Promise<RecordResult>>();
  const ledger = { path: PATH, list, record } as unknown as Ledger;
  return { ledger, list, record };
}

export const ok = (stdout: string): RunResult => ({
  stdout,
  stderr: "",
  code: 0,
});

export const failed = (code: number, stderr: string): RunResult => ({
  stdout: "",
  stderr,
  code,
});

/** An error the way node's fs reports it: a message and a `code`. */
export function withCode(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}
