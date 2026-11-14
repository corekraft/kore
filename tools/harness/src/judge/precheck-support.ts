// A typed CliDeps for the precheck specs: the runner is the caller's mock, and every other
// dependency is a stub that rejects, so a precheck that reaches for one fails the test.
import type { CliDeps, FileSystem, Runner } from "../runtime/index.js";

const untouched = (name: string) => (): Promise<never> =>
  Promise.reject(new Error(`the precheck does not use ${name}`));

const fileSystem: FileSystem = {
  readFile: untouched("readFile"),
  writeFile: untouched("writeFile"),
  createFile: untouched("createFile"),
  appendFile: untouched("appendFile"),
  exists: untouched("exists"),
  readdir: untouched("readdir"),
  remove: untouched("remove"),
  readlink: untouched("readlink"),
  mtimeMs: untouched("mtimeMs"),
  isDirectory: untouched("isDirectory"),
  readHead: untouched("readHead"),
  readFrom: untouched("readFrom"),
  hasGlobMatch: untouched("hasGlobMatch"),
};

/** The dependencies a precheck may touch, with this runner and the repository at /repo. */
export function fakeDeps(runner: Runner): CliDeps {
  return {
    runner,
    clock: {
      now: () => new Date("2026-11-14T10:00:00.000Z"),
      sleep: untouched("sleep"),
    },
    root: () => Promise.resolve("/repo"),
    ids: { next: () => "id-1" },
    env: {},
    cwd: "/work/tree",
    stdin: untouched("stdin"),
    stdout: () => undefined,
    stderr: () => undefined,
    fs: fileSystem,
  };
}
