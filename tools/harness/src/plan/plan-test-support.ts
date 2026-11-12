import type { CliDeps } from "../runtime/index.js";
import { FakeRunner } from "../runtime/runner-support.js";

export const ROOT = "/repo";

/** An in-memory repository holding plan files; writes land back in `files`. */
export function planHarness(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: { now: () => new Date("2026-01-02T12:00:00.000Z") },
    fs: {
      readFile: (path) => {
        const key = path.slice(ROOT.length + 1);
        return path.startsWith(`${ROOT}/`) && key in files
          ? Promise.resolve(files[key] ?? "")
          : Promise.reject(new Error(`ENOENT ${path}`));
      },
      writeFile: (path, content) => {
        const key = path.slice(ROOT.length + 1);
        files[key] = content;
        writes.push(key);
        return Promise.resolve();
      },
      createFile: () => Promise.resolve(),
      appendFile: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
      readdir: (path) =>
        path === `${ROOT}/infra/plans`
          ? Promise.resolve(
              Object.keys(files).map((f) => f.slice("infra/plans/".length)),
            )
          : Promise.reject(
              Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
            ),
    },
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    env: {},
    cwd: ROOT,
    root: () => Promise.resolve(ROOT),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return {
    deps,
    files,
    writes,
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

export const activePlan = (body: string) =>
  `---\nstatus: active\nsummary: s\nlast-verified: 2026-11-11\n---\n\n${body}`;
