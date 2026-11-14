// Fixtures for the test-budget spec: a fake repository, a vitest report and the hook's deps.
import { vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import type { BudgetReport } from "./test-budget-reporter.js";
import type { HookContext, HookResult } from "./io.js";

export const ROOT = "/repo";
export const SRC = `${ROOT}/tools/kore/src`;

export interface Case {
  title: string;
  duration: number;
}
export interface Spec {
  /** Path under tools/kore/src. */
  path: string;
  cases: Case[];
  /** File time in ms, import and collection included; defaults to the sum of the cases. */
  ms?: number;
}

export function reportOf(specs: Spec[], runMs?: number): string {
  const files = specs.map(({ path, cases, ms }) => ({
    name: `${SRC}/${path}`,
    ms: ms ?? cases.reduce((sum, c) => sum + c.duration, 0),
    tests: cases.map((c) => ({ name: c.title, ms: c.duration })),
  }));
  const report: BudgetReport = {
    runMs: runMs ?? files.reduce((sum, f) => sum + f.ms, 0),
    files,
  };
  return JSON.stringify(report);
}

export interface World {
  /** Contents of files by absolute path; a directory is a key ending in "/". */
  files: Record<string, string>;
}

const notUsed = (): never => {
  throw new Error("not used by the test-budget hook");
};

/** An fs error the way node reports it, so the hook can tell not-found from the rest. */
export function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

export function depsOf({ files }: World) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    runner: { run: vi.fn(notUsed) },
    clock: { now: vi.fn(notUsed), sleep: vi.fn(notUsed) },
    ids: { next: vi.fn(notUsed) },
    env: {},
    stdin: vi.fn(notUsed),
    root: vi.fn(async () => ROOT),
    fs: {
      readFile: vi.fn(async (path: string) => {
        const text = files[path];
        if (text === undefined) {
          throw fsError("ENOENT", path);
        }
        return text;
      }),
      writeFile: vi.fn(notUsed),
      createFile: vi.fn(notUsed),
      appendFile: vi.fn(notUsed),
      remove: vi.fn(notUsed),
      readlink: vi.fn(notUsed),
      hasGlobMatch: vi.fn(notUsed),
      mtimeMs: vi.fn(notUsed),
      readHead: vi.fn(notUsed),
      readFrom: vi.fn(notUsed),
      exists: vi.fn(
        async (path: string) => path in files || `${path}/` in files,
      ),
      isDirectory: vi.fn(async (path: string) => `${path}/` in files),
      readdir: vi.fn(async (path: string) =>
        Object.keys(files)
          .filter((file) => file.startsWith(`${path}/`))
          .map((file) => file.slice(path.length + 1).split("/")[0] ?? "")
          .filter((name, i, all) => name !== "" && all.indexOf(name) === i),
      ),
    },
    cwd: `${ROOT}/tools/kore`,
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text),
  };
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

/** The handler the hook gave the wrapper; the wrapper itself is mocked in the spec. */
export type Handler = (context: HookContext) => Promise<HookResult>;

/** Calls the handler the way the wrapper would, with the options already parsed. */
export function callHandler(
  handler: Handler,
  deps: CliDeps,
  options: Record<string, string | boolean>,
): Promise<HookResult> {
  return handler({ deps, options, operand: undefined, payload: undefined });
}

/** Runs the handler over a fake repository and a report of the given specs. */
export async function runHook(
  handler: Handler,
  world: World,
  specs: Spec[],
  options: Record<string, string | boolean> = {},
  runMs?: number,
) {
  const { deps } = depsOf({
    files: { ...world.files, [`${ROOT}/report.json`]: reportOf(specs, runMs) },
  });
  const result = await callHandler(handler, deps, {
    package: "tools/kore",
    report: `${ROOT}/report.json`,
    ...options,
  });
  return {
    code: result.code ?? 0,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

export const REPO: World = {
  files: {
    [`${SRC}/security/`]: "",
    [`${SRC}/security/scan.ts`]: "",
    [`${SRC}/security/scan.spec.ts`]: "",
    [`${SRC}/security/old.ts`]: "",
    [`${SRC}/security/old.spec.ts`]: "",
    [`${SRC}/security/unconverted.txt`]: "old.ts\n",
  },
};

/** One spec file holding one test. */
export const one = (
  path: string,
  title: string,
  duration: number,
  ms?: number,
): Spec => ({
  path,
  cases: [{ title, duration }],
  ...(ms === undefined ? {} : { ms }),
});

/** REPO with the security domain's list replaced. */
export const withList = (text: string): World => ({
  files: { ...REPO.files, [`${SRC}/security/unconverted.txt`]: text },
});

/** A package of two domains, each with the given list text, or none. */
export const twoDomains = (lists: Record<string, string>): World => ({
  files: {
    [`${SRC}/security/`]: "",
    [`${SRC}/security/scan.ts`]: "",
    [`${SRC}/images/`]: "",
    [`${SRC}/images/pin.ts`]: "",
    [`${SRC}/images/pin2.ts`]: "",
    ...Object.fromEntries(
      Object.entries(lists).map(([domain, text]) => [
        `${SRC}/${domain}/unconverted.txt`,
        text,
      ]),
    ),
  },
});

/** Runs the handler over REPO plus the given files, reading the report at `report`. */
export function runFiles(
  handler: Handler,
  files: World["files"],
  report = `${ROOT}/report.json`,
) {
  const { deps } = depsOf({ files: { ...REPO.files, ...files } });
  return {
    deps,
    result: () => callHandler(handler, deps, { package: "tools/kore", report }),
  };
}
