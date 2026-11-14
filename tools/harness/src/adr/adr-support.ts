import { vi } from "vitest";
import type { CliDeps, Clock, FileSystem } from "../runtime/index.js";
import { FakeRunner } from "../runtime/runner-support.js";
import { hasMatchUnder } from "../runtime/memory-filesystem-support.js";

export const PLAN = "infra/plans/10-tools-first-skills.md";
export const PLAN_TEXT =
  "---\nstatus: active\nsummary: Plan.\nlast-verified: 2026-01-01\n---\n\n# Plan\n\n## Step 1: ADR Tool\n";
export const ANCHOR = "step-1-adr-tool";

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

export const ROOT = "/repo";

/** In-memory files keyed by repo-relative path; every access must be under ROOT. */
export class MemoryFs implements FileSystem {
  readonly writes: string[] = [];
  constructor(readonly files: Map<string, string>) {}
  private rel(path: string): string {
    if (!path.startsWith(`${ROOT}/`)) {
      throw new Error(`path outside the repository root: ${path}`);
    }
    return path.slice(ROOT.length + 1);
  }
  readFile(path: string): Promise<string> {
    const text = this.files.get(this.rel(path));
    return text === undefined
      ? Promise.reject(new Error(`ENOENT ${path}`))
      : Promise.resolve(text);
  }
  writeFile(path: string, content: string): Promise<void> {
    this.writes.push(this.rel(path));
    this.files.set(this.rel(path), content);
    return Promise.resolve();
  }
  mtimeMs(path: string): Promise<number> {
    return this.files.has(this.rel(path))
      ? Promise.resolve(0)
      : Promise.reject(
          Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" }),
        );
  }

  readlink(path: string): Promise<string> {
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }
  isDirectory(): Promise<boolean> {
    return Promise.resolve(false);
  }
  readHead(path: string): Promise<string> {
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }
  readFrom(path: string): Promise<string> {
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }
  hasGlobMatch(cwd: string, pattern: string): Promise<boolean> {
    this.rel(cwd);
    const absolute = [...this.files.keys()].map((key) => `${ROOT}/${key}`);
    return Promise.resolve(hasMatchUnder(absolute, cwd, pattern));
  }

  remove(path: string): Promise<void> {
    this.files.delete(this.rel(path));
    return Promise.resolve();
  }
  createFile(path: string, content: string): Promise<void> {
    if (this.files.has(this.rel(path))) {
      return Promise.reject(
        Object.assign(new Error(`EEXIST ${path}`), { code: "EEXIST" }),
      );
    }
    return this.writeFile(path, content);
  }
  appendFile(path: string, content: string): Promise<void> {
    return this.writeFile(
      path,
      (this.files.get(this.rel(path)) ?? "") + content,
    );
  }
  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(this.rel(path)));
  }
  readdir(path: string): Promise<string[]> {
    const prefix = `${this.rel(path)}/`;
    return Promise.resolve(
      [...this.files.keys()]
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length)),
    );
  }
}

export function fixture(extra: Record<string, string> = {}) {
  const fs = new MemoryFs(
    new Map([
      ["docs/index.md", INDEX],
      ["docs/decisions/0001-first.md", adrFile("0001", "first")],
      ["docs/decisions/0003-third.md", adrFile("0003", "third")],
      [PLAN, PLAN_TEXT],
      ...Object.entries(extra),
    ]),
  );
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: {
      now: () => new Date(2026, 10, 11, 23, 59, 59),
      sleep: () => Promise.resolve(),
    },
    root: () => Promise.resolve(ROOT),
    env: {},
    cwd: "/repo",
    fs,
    stdout: (t) => out.push(t),
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    stderr: (t) => err.push(t),
  };
  return { fs, deps, out: () => out.join(""), err: () => err.join("") };
}

export const NEW = [
  "adr",
  "new",
  "--title",
  "Harness tools Are Great!",
  "--summary",
  "Tools are great.",
  "--status",
  "proposed",
  "--source",
  `${PLAN}#${ANCHOR}`,
];

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
