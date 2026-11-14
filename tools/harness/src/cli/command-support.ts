// Fakes shared by the cli domain's command unit specs. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { CliDeps, CommandContext, FileSystem } from "../runtime/index.js";

export const NOW = "2026-01-02T03:04:05.000Z";

/**
 * A command context with its output captured. Only `writeFile` on the file
 * system is real here: a command reads and writes through the units it calls,
 * which each spec mocks.
 */
export function fakeContext(overrides: Partial<CommandContext> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const writeFile = vi.fn<FileSystem["writeFile"]>(() => Promise.resolve());
  const deps: CliDeps = {
    runner: {
      run: () => Promise.reject(new Error("the flag command runs no process")),
    },
    clock: { now: () => new Date(NOW), sleep: () => Promise.resolve() },
    // The cast stands in for the rest of the file system, which these units never call.
    fs: { writeFile } as unknown as FileSystem,
    root: () => Promise.resolve("/repo"),
    ids: { next: () => "id-1" },
    env: {},
    cwd: "/repo",
    stdin: () => Promise.resolve(""),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const context: CommandContext = {
    json: false,
    options: {},
    deps,
    ...overrides,
  };
  return {
    context,
    deps,
    writeFile,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

/**
 * A ledger that lists the given events and records every event it is given.
 * The cast stands in for the ledger's file handling, which the spec never reaches.
 */
export function fakeLedger(
  listed: { label: string }[] = [],
  record: Awaited<ReturnType<Ledger["record"]>> = {
    ok: true,
    event: {} as LedgerEvent,
  },
) {
  const list = vi.fn<Ledger["list"]>(() =>
    Promise.resolve({
      events: listed as LedgerEvent[],
      skipped: 0,
    }),
  );
  const write = vi.fn<Ledger["record"]>(() => Promise.resolve(record));
  return { ledger: { list, record: write } as unknown as Ledger, write, list };
}
