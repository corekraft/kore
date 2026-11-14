import type { CliDeps } from "../runtime/index.js";
import { MemoryFileSystem } from "./memory-filesystem-support.js";
import { FakeRunner } from "./runner-support.js";

export const DEFAULT = "/repo/.kore/state/ledger.jsonl";

interface Options {
  stdin?: string;
  cwd?: string;
  /** This checkout's root, as the root resolver reports it. Defaults to /repo. */
  root?: string;
  env?: Record<string, string>;
  /** What `git rev-parse --git-common-dir` prints; undefined means git fails. */
  commonDir?: string | undefined;
}

export function harness(stdin = "", options: Options = {}) {
  const { cwd = "/repo", env = {}, root = "/repo" } = options;
  const commonDir = "commonDir" in options ? options.commonDir : "/repo/.git";
  const runner = new FakeRunner([
    {
      match: (c, a) => c === "git" && a.includes("--git-common-dir"),
      result:
        commonDir === undefined
          ? { code: 128, stderr: "fatal: not a git repository" }
          : { stdout: `${commonDir}\n` },
    },
  ]);
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem();
  let n = 0;
  const deps: CliDeps = {
    runner,
    clock: {
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      sleep: () => Promise.resolve(),
    },
    fs,
    root: () => Promise.resolve(root),
    ids: { next: () => `id-${++n}` },
    env,
    cwd,
    stdin: () => Promise.resolve(stdin),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { deps, fs, runner, out: () => out.join(""), err: () => err.join("") };
}
