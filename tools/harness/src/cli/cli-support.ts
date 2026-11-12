import { FakeRunner, type FakeResponse } from "../runtime/runner-support.js";
import type { CliDeps } from "../runtime/index.js";

export interface TestHarness {
  deps: CliDeps;
  /** Everything written through the fake filesystem, by absolute path. */
  files: Map<string, string>;
  runner: FakeRunner;
  out(): string;
  err(): string;
}

/** Deps for command tests: a fake runner, captured output, and a settable environment. */
export function testHarness(
  options: {
    env?: Record<string, string | undefined>;
    responses?: readonly FakeResponse[];
    /** Files the fake filesystem starts with, by absolute path. */
    files?: Record<string, string>;
  } = {},
): TestHarness {
  const out: string[] = [];
  const err: string[] = [];
  const runner = new FakeRunner(options.responses);
  const files = new Map(Object.entries(options.files ?? {}));
  let time = Date.parse("2026-01-02T03:04:05.000Z");
  const deps: CliDeps = {
    runner,
    clock: {
      now: () => new Date(time),
      sleep: (ms) => {
        time += ms;
        return Promise.resolve();
      },
    },
    fs: {
      readFile: (path) => {
        const content = files.get(path);
        return content === undefined
          ? Promise.reject(new Error(`ENOENT: ${path}`))
          : Promise.resolve(content);
      },
      writeFile: (path, content) => {
        files.set(path, content);
        return Promise.resolve();
      },
      createFile: () => Promise.resolve(),
      appendFile: () => Promise.resolve(),
      remove: (path) => {
        files.delete(path);
        return Promise.resolve();
      },
      exists: (path) => Promise.resolve(files.has(path)),
      readdir: () => Promise.resolve([]),
    },
    root: () => Promise.resolve("/repo"),
    env: options.env ?? {},
    cwd: "/work/tree",
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return {
    deps,
    files,
    runner,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}
