// The test-budget hook's inputs, through its entry point: the command the host runs as
// `harness hook test-budget`. The unit is the hook; the hook wrapper is mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "./io.js";
import "./test-budget.js";
import {
  REPO,
  ROOT,
  callHandler,
  depsOf,
  fsError,
  reportOf,
  runHook,
  type Spec,
  type World,
} from "./test-budget-support.js";

vi.mock("./io.js");

/** The wrapper is automocked, so its first call keeps the name, flags and handler the hook registered. */
const [, , handler] = vi.mocked(hookCommand).mock.calls[0] as Parameters<
  typeof hookCommand
>;

const run = (
  world: World,
  specs: Spec[],
  options: Record<string, string | boolean> = {},
  runMs?: number,
) => runHook(handler, world, specs, options, runMs);

describe("harness hook test-budget: report paths", () => {
  it("fails naming both paths when the report's specs are not under the repository's package, instead of budgeting nothing", async () => {
    const { deps } = depsOf({
      files: {
        ...REPO.files,
        [`${ROOT}/report.json`]: JSON.stringify({
          runMs: 5,
          files: [
            {
              name: "/other/checkout/tools/kore/src/a.spec.ts",
              ms: 5,
              tests: [],
            },
          ],
        }),
      },
    });
    const result = await callHandler(handler, deps, {
      package: "tools/kore",
      report: `${ROOT}/report.json`,
    });
    expect(result).toEqual({
      code: 1,
      stderr:
        "test-budget: the report holds specs under /other/checkout/tools/kore/src, but the repository root /repo puts tools/kore at /repo/tools/kore/src; run the unit tests and this check from the same checkout\n",
    });
  });

  it("budgets a report with no specs at all without complaint", async () => {
    const { code } = await run(REPO, []);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: inputs", () => {
  it("reads a relative report path from the working directory", async () => {
    const { deps } = depsOf({
      files: {
        ...REPO.files,
        [`${ROOT}/tools/kore/out/unit.json`]: reportOf([]),
      },
    });
    const result = await callHandler(handler, deps, {
      package: "tools/kore",
      report: "out/unit.json",
    });
    expect(result.code).toBe(0);
  });

  it("fails naming the command to run when the report is missing, instead of passing", async () => {
    const { deps } = depsOf({ files: REPO.files });
    const result = await callHandler(handler, deps, {
      package: "tools/kore",
      report: `${ROOT}/missing.json`,
    });
    expect(result).toEqual({
      code: 1,
      stderr:
        "test-budget: no unit report at /repo/missing.json; run `npm run test:unit` in tools/kore, which writes it before this check reads it\n",
    });
  });

  it("does not turn a malformed report into a missing one, so the wrapper fails the run with the real error", async () => {
    const { deps } = depsOf({
      files: { ...REPO.files, [`${ROOT}/bad.json`]: "{not json" },
    });
    await expect(
      callHandler(handler, deps, {
        package: "tools/kore",
        report: `${ROOT}/bad.json`,
      }),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it("does not turn an unreadable report into a missing one", async () => {
    const { deps } = depsOf({ files: REPO.files });
    vi.spyOn(deps.fs, "readFile").mockRejectedValueOnce(
      fsError("EACCES", "/repo/report.json"),
    );
    await expect(
      callHandler(handler, deps, {
        package: "tools/kore",
        report: `${ROOT}/report.json`,
      }),
    ).rejects.toMatchObject({ code: "EACCES" });
  });

  it("fails naming the flags when --package or --report is missing", async () => {
    const { deps } = depsOf({ files: REPO.files });
    const result = await callHandler(handler, deps, {});
    expect(result).toEqual({
      code: 1,
      stderr:
        "test-budget: pass --package <dir, such as tools/kore> and --report <json file the unit run writes>\n",
    });
  });
});
