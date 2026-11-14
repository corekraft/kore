import { vi, type MockedFunction } from "vitest";
import type {
  CliDeps,
  CommandContext,
  RunOptions,
  RunResult,
  Runner,
} from "../runtime/index.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

/** A runner fake whose calls are recorded in `run.mock.calls`; each reply comes from the command and its arguments. */
export interface FakeRunner {
  runner: Runner;
  run: MockedFunction<Runner["run"]>;
}

export function fakeRunner(
  reply: (
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ) => Partial<RunResult>,
): FakeRunner {
  const run = vi.fn<Runner["run"]>(
    (command: string, args: readonly string[], options?: RunOptions) =>
      Promise.resolve({
        stdout: "",
        stderr: "",
        code: 0,
        ...reply(command, args, options),
      }),
  );
  return { runner: { run }, run };
}

/** A successful reply carrying the given stdout. */
export const ok = (stdout = ""): Partial<RunResult> => ({ stdout });

/** A failed reply carrying the given stderr. */
export const failed = (stderr: string): Partial<RunResult> => ({
  code: 1,
  stderr,
});

/** The worktree a writer session ran in. */
export const WORKTREE = { path: "/main/.claude/worktrees/x", branch: "feat/x" };

const RESULT = { outcome: "done" as const, at: "2026-01-02T03:05:00.000Z" };
const IDENTITY = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};

/** The same session before its result was recorded, and without a worktree. */
export const UNRESULTED: SessionRecord = { ...IDENTITY };

/** The same session with its result recorded, and without a worktree. */
export const WITHOUT_WORKTREE: SessionRecord = { ...IDENTITY, result: RESULT };

/** A session the caller spawned, with its result recorded and a worktree, ready to close. */
export const SPAWNED: SessionRecord = {
  ...WITHOUT_WORKTREE,
  worktree: WORKTREE,
};

/** The registry's two calls close makes: a read to find the session, a write to mark it closed. */
export interface FakeRegistry {
  read: MockedFunction<(name: string) => Promise<SessionRecord | undefined>>;
  write: MockedFunction<(record: SessionRecord) => Promise<void>>;
}

export function fakeRegistry(record: SessionRecord | undefined): FakeRegistry {
  return {
    read: vi.fn((): Promise<SessionRecord | undefined> =>
      Promise.resolve(record),
    ),
    write: vi.fn((): Promise<void> => Promise.resolve()),
  };
}

/** The `SessionRegistry` class is the one mocked; the fake keeps only the two methods close uses. */
export const asRegistry = (fake: FakeRegistry): SessionRegistry =>
  fake as unknown as SessionRegistry;

export interface Scene {
  context: CommandContext;
  runner: FakeRunner;
  stdout: MockedFunction<(text: string) => void>;
  stderr: MockedFunction<(text: string) => void>;
}

/** A command context inside Herdr by default; only the deps close reads are real. */
export function scene(
  options: {
    operand?: string | undefined;
    env?: Record<string, string>;
    json?: boolean;
    flags?: Record<string, string | boolean>;
    herdr?: Partial<RunResult>;
  } = {},
): Scene {
  const runner = fakeRunner((command) =>
    command === "herdr" ? (options.herdr ?? {}) : {},
  );
  const stdout = vi.fn<(text: string) => void>();
  const stderr = vi.fn<(text: string) => void>();
  const deps = {
    runner: runner.runner,
    clock: { now: () => new Date("2026-01-02T03:06:00.000Z") },
    env: options.env ?? { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" },
    cwd: "/main",
    stdout,
    stderr,
  } as unknown as CliDeps;
  return {
    context: {
      json: options.json ?? false,
      deps,
      operand: "operand" in options ? options.operand : SPAWNED.name,
      options: options.flags ?? {},
    },
    runner,
    stdout,
    stderr,
  };
}
