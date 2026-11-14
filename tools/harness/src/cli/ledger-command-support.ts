// Fixtures and fakes for the ledger command unit spec. A support file is not a unit, so it needs no spec (ADR 0098).
import { vi } from "vitest";
import { DEFAULT_LEDGER, type LedgerEvent } from "../ledger/index.js";
import { contextWith } from "./command-support.js";

export const MAIN = "/main";
export const LEDGER_PATH = `${MAIN}/${DEFAULT_LEDGER}`;

export const EVENT: LedgerEvent = {
  schema: 1,
  id: "id-1",
  source: "claude",
  kind: "session.start",
  occurredAt: "2026-01-02T03:00:00Z",
  recordedAt: "2026-01-02T03:04:05.000Z",
  session: "s1",
};

export const HERDR_EVENT: LedgerEvent = {
  schema: 1,
  id: "id-2",
  source: "herdr",
  kind: "pane.spawned",
  occurredAt: "2026-01-02T04:00:00Z",
  recordedAt: "2026-01-02T03:04:05.000Z",
  pane: "w3:p1",
};

/** Every list flag at once; the flags and the ledger filter it becomes have the same names. */
export const FILTER = {
  session: "s1",
  pane: "w3:p1",
  idea: "0001",
  source: "herdr",
  kind: "pane.spawned",
  since: "2026-01-02T03:30:00Z",
  until: "2026-01-02T04:00:00Z",
};

export const GITHUB_EVENT: LedgerEvent = {
  ...EVENT,
  source: "github",
  kind: "pr.opened",
  id: "g1",
};

/** The deps a ledger command reads, each a fake the spec asserts on. */
export function fakes(stdin = "") {
  return {
    runner: { run: vi.fn() },
    clock: { now: vi.fn(), sleep: vi.fn() },
    fs: {},
    ids: { next: vi.fn() },
    env: {},
    cwd: "/repo",
    stdin: vi.fn(() => Promise.resolve(stdin)),
    stdout: vi.fn<(text: string) => void>(),
    stderr: vi.fn<(text: string) => void>(),
  };
}

/** A command context over the fakes, with the flags, JSON mode and stdin it was run with. */
export function ctx(
  options: Record<string, string | boolean> = {},
  { json = false, stdin = "" } = {},
) {
  const deps = fakes(stdin);
  return { context: contextWith(deps, options, json), deps };
}
