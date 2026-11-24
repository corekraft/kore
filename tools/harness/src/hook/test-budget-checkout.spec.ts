// The test-budget hook's checkout: the report the commit's own checkout wrote is
// judged, the main root's report only when that checkout has none, and the
// checkout is the one git names for the working directory, not the bundle's.
// Split from test-budget.spec.ts to keep each spec under 300 lines.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "./io.js";
import "./test-budget.js";
import { mainRoot } from "../runtime/index.js";
import {
  ROOT,
  callHandler,
  depsOf,
  type Handler,
} from "./test-budget-support.js";

vi.mock("./io.js");
vi.mock("../runtime/index.js", () => ({ mainRoot: vi.fn() }));

/** The wrapper is automocked, so its first call keeps the handler the hook registered. */
const [, , handler] = vi.mocked(hookCommand).mock.calls[0] as Parameters<
  typeof hookCommand
>;

const MAIN = "/main";
const SLOW =
  "test-budget: tools/kore/src/security/scan.spec.ts > scans took 154 ms, 54 ms over the 100 ms test budget; mock what it imports and drop real timers and processes, so it tests one unit alone (ADR 0098)\n";

/** A checkout's one converted domain with one spec file. */
function sourceUnder(root: string): Record<string, string> {
  return {
    [`${root}/tools/kore/src/security/`]: "",
    [`${root}/tools/kore/src/security/scan.ts`]: "",
    [`${root}/tools/kore/src/security/scan.spec.ts`]: "",
  };
}

/** The report a unit run in that checkout writes: one spec with one test that took ms. */
function reportUnder(root: string, ms: number): string {
  return JSON.stringify({
    runMs: ms,
    files: [
      {
        name: `${root}/tools/kore/src/security/scan.spec.ts`,
        ms,
        tests: [{ name: "scans", ms }],
      },
    ],
  });
}

/** Where the unit run in that checkout writes its report, under the package. */
const reportPath = (root: string) =>
  `${root}/tools/kore/test-results/unit.json`;

/** The package script's call: the report named relative to the package directory. */
const runFromPackage = (deps: ReturnType<typeof depsOf>["deps"]) =>
  callHandler(handler as Handler, deps, {
    package: "tools/kore",
    report: "test-results/unit.json",
  });

describe("harness hook test-budget: the commit's own checkout", () => {
  it("judges the report the commit's checkout wrote, not a stale one in the main root", async () => {
    const { deps } = depsOf({
      files: {
        ...sourceUnder(ROOT),
        ...sourceUnder(MAIN),
        [reportPath(ROOT)]: reportUnder(ROOT, 154),
        [reportPath(MAIN)]: reportUnder(MAIN, 5),
      },
    });
    vi.mocked(mainRoot).mockResolvedValue(MAIN);
    const readFile = vi.spyOn(deps.fs, "readFile");
    const result = await runFromPackage(deps);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(SLOW);
    expect(readFile).not.toHaveBeenCalledWith(reportPath(MAIN));
  });

  it("reads the main root's report only when the commit's checkout has none", async () => {
    const { deps } = depsOf({
      files: {
        ...sourceUnder(MAIN),
        [reportPath(MAIN)]: reportUnder(MAIN, 154),
      },
    });
    vi.mocked(mainRoot).mockResolvedValue(MAIN);
    const result = await runFromPackage(deps);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(SLOW);
  });

  it("fails as before, naming the commit's report path, when neither checkout has a report", async () => {
    const { deps } = depsOf({
      files: { ...sourceUnder(ROOT), ...sourceUnder(MAIN) },
    });
    vi.mocked(mainRoot).mockResolvedValue(MAIN);
    const result = await runFromPackage(deps);
    expect(result).toEqual({
      code: 1,
      stderr: `test-budget: no unit report at ${reportPath(ROOT)}; run \`npm run test:unit\` in tools/kore, which writes it before this check reads it\n`,
    });
  });

  it("names the checkout git reports for the working directory, not the bundle's root", async () => {
    const { deps } = depsOf({
      files: {
        ...sourceUnder(ROOT),
        [reportPath(ROOT)]: reportUnder(ROOT, 154),
      },
    });
    // The bundle runs from the main checkout, while git says the commit is made in ROOT.
    vi.spyOn(deps, "root").mockResolvedValue(MAIN);
    const result = await runFromPackage(deps);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(SLOW);
  });

  it("falls back to the bundle's root when git cannot name the checkout", async () => {
    const { deps } = depsOf({
      files: {
        ...sourceUnder(ROOT),
        [reportPath(ROOT)]: reportUnder(ROOT, 154),
      },
    });
    vi.spyOn(deps.runner, "run").mockResolvedValue({
      code: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
    });
    const result = await runFromPackage(deps);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(SLOW);
  });
});
