import type { CliDeps } from "../runtime/index.js";
import { FakeRunner } from "./runner-support.js";

const ROOT = "/repo";

/**
 * An in-memory repository holding plan files; writes land back in `files`.
 * Integration specs run the real plan commands through it.
 */
export function planHarness(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const writes: string[] = [];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: {
      now: () => new Date("2026-01-02T12:00:00.000Z"),
      sleep: () => Promise.resolve(),
    },
    fs: {
      hasGlobMatch: () => Promise.resolve(false),
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
      readlink: () => Promise.reject(new Error("ENOENT")),
      mtimeMs: () => Promise.resolve(0),
      isDirectory: () => Promise.resolve(false),
      readHead: () => Promise.reject(new Error("ENOENT")),
      readFrom: () => Promise.reject(new Error("ENOENT")),
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

/** The plan file the tick specs write, and its body: one open item per list entry, with totals. */
export const TICK_PLAN_FILE = "infra/plans/2-a.md";

export const TICK_BODY = `## Step 1: Alpha

- [ ] Wire the alpha gate
- [ ] Prove the beta path
      across two lines
- [x] Done already

## Step 2: Beta

- [ ] Ship the gamma release

## Where each open item can be done

Every item sits in one class (as of 2026-11-09: 2 local, 1 managed
cluster, 1 release pipeline).

### Local

- Step 1 (2): Wire the alpha gate (offline only); Prove the beta path
  across two lines.

### Managed cluster

- Step 2 (1): Ship the gamma release.

### Release pipeline and repository settings

- Step 1 (1): Tag it.

## Step 3: After

- [ ] Later
`;

export function tickPlan(body = TICK_BODY) {
  return planHarness({ [TICK_PLAN_FILE]: activePlan(body) });
}
