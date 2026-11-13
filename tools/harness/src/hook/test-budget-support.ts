// Fixtures for the test-budget spec: a fake repository, a vitest report and the hook's deps.
import { vi } from "vitest";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { testBudgetHook } from "./test-budget.js";

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
  /** File wall time in ms; defaults to the sum of the cases. */
  span?: [number, number];
}

export function reportOf(specs: Spec[]): string {
  return JSON.stringify({
    testResults: specs.map(({ path, cases, span }) => ({
      name: `${SRC}/${path}`,
      startTime: span?.[0] ?? 0,
      endTime: span?.[1] ?? cases.reduce((sum, c) => sum + c.duration, 0),
      assertionResults: cases.map((c) => ({
        fullName: c.title,
        title: c.title,
        duration: c.duration,
        status: "passed",
      })),
    })),
  });
}

export interface World {
  /** Contents of files by absolute path; a directory is a key ending in "/". */
  files: Record<string, string>;
}

export function depsOf({ files }: World) {
  const out: string[] = [];
  const err: string[] = [];
  const deps = {
    root: vi.fn(async () => ROOT),
    fs: {
      readFile: vi.fn(async (path: string) => {
        const text = files[path];
        if (text === undefined) {
          throw new Error(`ENOENT ${path}`);
        }
        return text;
      }),
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
  } as unknown as CliDeps;
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

/** Runs the hook with the handler the wrapper was given, the way the host would. */
export async function runHook(
  world: World,
  specs: Spec[],
  options: Record<string, string | boolean> = {},
) {
  const { deps, out, err } = depsOf({
    files: { ...world.files, [`${ROOT}/report.json`]: reportOf(specs) },
  });
  const code = await testBudgetHook.run({
    deps,
    json: false,
    options: {
      package: "tools/kore",
      report: `${ROOT}/report.json`,
      ...options,
    },
  } as CommandContext);
  return { code, out: out(), err: err() };
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
