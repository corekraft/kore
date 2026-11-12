import { FakeRunner, type FakeResponse } from "../runtime/runner-support.js";
import type { CliDeps } from "../runtime/index.js";

export interface TestHarness {
  deps: CliDeps;
  runner: FakeRunner;
  out(): string;
  err(): string;
}

/** Deps for command tests: a fake runner, captured output, and a settable environment. */
export function testHarness(
  options: {
    env?: Record<string, string | undefined>;
    responses?: readonly FakeResponse[];
  } = {},
): TestHarness {
  const out: string[] = [];
  const err: string[] = [];
  const runner = new FakeRunner(options.responses);
  const deps: CliDeps = {
    runner,
    clock: { now: () => new Date("2026-01-02T03:04:05.000Z") },
    fs: {
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      createFile: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
      readdir: () => Promise.resolve([]),
    },
    root: () => Promise.resolve("/repo"),
    env: options.env ?? {},
    cwd: "/work/tree",
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { deps, runner, out: () => out.join(""), err: () => err.join("") };
}
