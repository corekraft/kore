import { vi } from "vitest";
import type { CliDeps, Clock, FileSystem } from "../runtime/index.js";

// Fakes and fixtures for the adr unit specs. Integration fixtures live in the
// testing domain (src/testing/adr-support.ts); this file is not a unit.

export const PLAN = "infra/plans/10-tools-first-skills.md";
export const PLAN_TEXT =
  "---\nstatus: active\nsummary: Plan.\nlast-verified: 2026-01-01\n---\n\n# Plan\n\n## Step 1: ADR Tool\n";
export const ANCHOR = "step-1-adr-tool";
export const ROOT = "/repo";

export const INDEX = [
  "# Index",
  "",
  "## Plans",
  "",
  `- [\`${PLAN}\`](../${PLAN}) — plan.`,
  "",
  "## Decisions",
  "",
  "- [`docs/decisions/0001-first.md`](decisions/0001-first.md) — first.",
  "- [`docs/decisions/0003-third.md`](decisions/0003-third.md) — third.",
  "",
  "## Operations",
  "",
].join("\n");

export function adrFile(n: string, slug: string): string {
  return [
    "---",
    "status: accepted",
    "summary: Existing.",
    "date: 2026-01-01",
    "last-verified: 2026-01-01",
    "---",
    "",
    `# ADR ${n}: ${slug}`,
    "",
  ].join("\n");
}

/** Stands in for a method a unit must never reach: a call fails the test that made it. */
const unreached = (name: string) => (): never => {
  throw new Error(`adr must not call ${name} here`);
};

/** A fixed clock; `now` returns the same instant and `sleep` resolves at once. */
export function fakeClock(now: Date): Clock {
  return {
    now: vi.fn<Clock["now"]>(() => now),
    sleep: vi.fn<Clock["sleep"]>(() => Promise.resolve()),
  };
}

/**
 * A FileSystem whose methods are typed mocks over `files` (repository-relative
 * paths under ROOT). Writes land in the same store, so a later read sees them.
 * Methods the decisions code never calls throw if reached.
 */
export function fakeFileSystem(files: Record<string, string> = {}) {
  const store = new Map(
    Object.entries(files).map(([path, text]) => [`${ROOT}/${path}`, text]),
  );
  const children = (dir: string) =>
    [...store.keys()]
      .filter((key) => key.startsWith(`${dir}/`))
      .map((key) => key.slice(dir.length + 1))
      .filter((rest) => !rest.includes("/"));
  return {
    readFile: vi.fn<FileSystem["readFile"]>((path) => {
      const text = store.get(path);
      return text === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(text);
    }),
    writeFile: vi.fn<FileSystem["writeFile"]>((path, text) => {
      store.set(path, text);
      return Promise.resolve();
    }),
    exists: vi.fn<FileSystem["exists"]>((path) =>
      Promise.resolve(store.has(path)),
    ),
    readdir: vi.fn<FileSystem["readdir"]>((dir) =>
      Promise.resolve(children(dir)),
    ),
    createFile: vi.fn<FileSystem["createFile"]>(unreached("createFile")),
    appendFile: vi.fn<FileSystem["appendFile"]>(unreached("appendFile")),
    remove: vi.fn<FileSystem["remove"]>(unreached("remove")),
    readlink: vi.fn<FileSystem["readlink"]>(unreached("readlink")),
    mtimeMs: vi.fn<FileSystem["mtimeMs"]>(unreached("mtimeMs")),
    isDirectory: vi.fn<FileSystem["isDirectory"]>(unreached("isDirectory")),
    readHead: vi.fn<FileSystem["readHead"]>(unreached("readHead")),
    readFrom: vi.fn<FileSystem["readFrom"]>(unreached("readFrom")),
    hasGlobMatch: vi.fn<FileSystem["hasGlobMatch"]>(unreached("hasGlobMatch")),
  } satisfies FileSystem;
}

/**
 * Every dependency of the CLI as a typed mock; the spec chooses `fs` and `clock`.
 * The mocks that a spec asserts on are returned beside `deps`, so the spec reads
 * them as plain mocks rather than as methods of an interface.
 */
export function fakeDeps(
  fs: FileSystem = fakeFileSystem(),
  clock: Clock = fakeClock(new Date(2026, 10, 11, 23, 59, 59)),
) {
  const root = vi.fn<CliDeps["root"]>(() => Promise.resolve(ROOT));
  const stdout = vi.fn<CliDeps["stdout"]>();
  const stderr = vi.fn<CliDeps["stderr"]>();
  const deps: CliDeps = {
    runner: { run: vi.fn<CliDeps["runner"]["run"]>(unreached("run")) },
    clock,
    fs,
    root,
    ids: { next: vi.fn<CliDeps["ids"]["next"]>(() => "id-1") },
    env: {},
    cwd: ROOT,
    stdin: vi.fn<CliDeps["stdin"]>(() => Promise.resolve("")),
    stdout,
    stderr,
  };
  return { deps, mocks: { root, stdout, stderr } };
}
