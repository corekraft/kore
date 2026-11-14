// The test-budget hook, through its entry point: the command the host runs as
// `harness hook test-budget`. The unit is the hook; the hook wrapper is mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "./io.js";
import "./test-budget.js";
import {
  REPO,
  ROOT,
  SRC,
  callHandler,
  depsOf,
  fsError,
  one,
  reportOf,
  runFiles,
  runHook,
  twoDomains,
  withList,
  type Spec,
  type World,
} from "./test-budget-support.js";

vi.mock("./io.js");

/** The wrapper is automocked, so its first call keeps the name, flags and handler the hook registered. */
const [name, summary, handler, shape] = vi.mocked(hookCommand).mock
  .calls[0] as Parameters<typeof hookCommand>;

const run = (
  world: World,
  specs: Spec[],
  options: Record<string, string | boolean> = {},
  runMs?: number,
) => runHook(handler, world, specs, options, runMs);

describe("harness hook test-budget: registration", () => {
  it("registers as test-budget with its flags, ignoring stdin, and failing the run when the check itself breaks", () => {
    expect(name).toBe("test-budget");
    expect(summary).toMatch(/^fail a unit run/);
    expect(shape).toEqual({
      flags: { package: "string", report: "string" },
      payload: false,
      faultCode: 1,
    });
  });
});

describe("harness hook test-budget: tests", () => {
  it("fails a slow test for a converted file, naming the test and its time", async () => {
    const { code, err } = await run(REPO, [
      one("security/scan.spec.ts", "scans", 154),
    ]);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/scan.spec.ts > scans took 154 ms, 54 ms over the 100 ms test budget; mock what it imports and drop real timers and processes, so it tests one unit alone (ADR 0098)\n",
    );
  });

  it("does not fail a slow test for a listed file, and still prints it among the slowest", async () => {
    const { code, out, err } = await run(REPO, [
      one("security/old.spec.ts", "walks", 900),
    ]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe(
      "slowest tests:\n  900 ms  tools/kore/src/security/old.spec.ts > walks\n",
    );
  });

  it("prints the ten slowest tests, slowest first", async () => {
    const cases = Array.from({ length: 12 }, (_, i) => ({
      title: `t${i}`,
      duration: i + 1,
    }));
    const { out } = await run(REPO, [{ path: "security/scan.spec.ts", cases }]);
    const lines = out.trimEnd().split("\n");
    expect(lines).toHaveLength(11);
    expect(lines[1]).toBe(
      "   12 ms  tools/kore/src/security/scan.spec.ts > t11",
    );
    expect(lines[10]).toBe(
      "    3 ms  tools/kore/src/security/scan.spec.ts > t2",
    );
  });
});

describe("harness hook test-budget: spec files", () => {
  it("fails a converted spec file over one second", async () => {
    const { code, err } = await run(REPO, [
      one("security/scan.spec.ts", "scans", 5, 1250),
    ]);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/scan.spec.ts took 1250 ms, 250 ms over the 1000 ms spec file budget, import and collection included; mock what the file imports, or split the spec (ADR 0098)\n",
    );
  });

  it("does not fail a listed spec file over one second", async () => {
    const { code } = await run(REPO, [
      one("security/old.spec.ts", "walks", 5, 4000),
    ]);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: lists", () => {
  it("fails a list that names a file that does not exist, so lists cannot rot", async () => {
    const { code, err } = await run(withList("old.ts\ngone.ts\n"), []);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/unconverted.txt names gone.ts, which does not exist; remove the line\n",
    );
  });

  it("ignores blank lines and comments in a list", async () => {
    const { code } = await run(withList("# batch 1\n\nold.ts\n"), []);
    expect(code).toBe(0);
  });

  it("does not budget a spec that has no source file beside it", async () => {
    const { code } = await run(REPO, [
      one("security/orphan.spec.ts", "x", 800),
    ]);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: domains", () => {
  it("budgets a spec in a nested directory against the domain's list", async () => {
    const deep = (list: string): World => ({
      files: {
        ...withList(list).files,
        [`${SRC}/security/deep/`]: "",
        [`${SRC}/security/deep/a.ts`]: "",
        [`${SRC}/security/deep/a.spec.ts`]: "",
      },
    });
    const slow = [one("security/deep/a.spec.ts", "a", 500)];
    const listed = await run(deep("old.ts\ndeep/a.ts\n"), slow);
    expect(listed.code).toBe(0);
    const unlisted = await run(deep("old.ts\n"), slow);
    expect(unlisted.code).toBe(1);
  });

  it("budgets a domain with no list as converted", async () => {
    const world: World = {
      files: {
        [`${SRC}/images/`]: "",
        [`${SRC}/images/pin.ts`]: "",
        [`${SRC}/images/pin.spec.ts`]: "",
      },
    };
    const { code } = await run(world, [one("images/pin.spec.ts", "pins", 101)]);
    expect(code).toBe(1);
  });
});

describe("harness hook test-budget: package run", () => {
  const slowRun: Spec[] = [
    one("security/scan.spec.ts", "a", 1),
    one("images/pin.spec.ts", "a", 1),
    one("images/pin2.spec.ts", "a", 1),
  ];

  it("fails a run over 20 seconds once every list is empty", async () => {
    const world = twoDomains({ security: "" });
    const { code, err } = await run(world, slowRun, {}, 21_300);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: the tools/kore unit run took 21300 ms, 1300 ms over the 20000 ms package budget, startup and global setup included; the slowest specs are printed above, so speed those up or split them (ADR 0098)\n",
    );
  });

  it("does not apply the 20 second limit while any list still names a file", async () => {
    const world = twoDomains({ security: "scan.ts\n" });
    const { code, err } = await run(world, slowRun, {}, 21_300);
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});

describe("harness hook test-budget: report paths", () => {
  const reportWith = (files: unknown[]) => ({
    [`${ROOT}/report.json`]: JSON.stringify({ runMs: 5, files }),
  });
  const slowInside = {
    name: `${SRC}/security/scan.spec.ts`,
    ms: 154,
    tests: [{ name: "scans", ms: 154 }],
  };

  it("fails naming both paths when the report's specs are not under the repository's package, instead of budgeting nothing", async () => {
    const outside = "/other/checkout/tools/kore/src/a.spec.ts";
    const { result } = runFiles(
      handler,
      reportWith([{ name: outside, ms: 5, tests: [] }]),
    );
    expect(await result()).toEqual({
      code: 1,
      stderr:
        "test-budget: the report holds specs under /other/checkout/tools/kore/src, but the repository root /repo puts tools/kore at /repo/tools/kore/src; run the unit tests and this check from the same checkout\n",
    });
  });

  it("budgets the specs under the package and skips the ones outside it, when a report holds both", async () => {
    const outside = { name: "/elsewhere/a.spec.ts", ms: 5000, tests: [] };
    const { result } = runFiles(handler, reportWith([outside, slowInside]));
    expect(await result()).toEqual({
      code: 1,
      stdout:
        "slowest tests:\n  154 ms  tools/kore/src/security/scan.spec.ts > scans\n",
      stderr:
        "test-budget: tools/kore/src/security/scan.spec.ts > scans took 154 ms, 54 ms over the 100 ms test budget; mock what it imports and drop real timers and processes, so it tests one unit alone (ADR 0098)\n",
    });
  });

  it("budgets a report with no specs at all without complaint", async () => {
    const { code } = await run(REPO, []);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: inputs", () => {
  it("reads a relative report path from the working directory", async () => {
    const { result } = runFiles(
      handler,
      { [`${ROOT}/tools/kore/out/unit.json`]: reportOf([]) },
      "out/unit.json",
    );
    expect((await result()).code).toBe(0);
  });

  it("fails naming the command to run when the report is missing, instead of passing", async () => {
    const { result } = runFiles(handler, {}, `${ROOT}/missing.json`);
    expect(await result()).toEqual({
      code: 1,
      stderr:
        "test-budget: no unit report at /repo/missing.json; run `npm run test:unit` in tools/kore, which writes it before this check reads it\n",
    });
  });

  it("does not turn a malformed report into a missing one, so the wrapper fails the run with the real error", async () => {
    const { result } = runFiles(handler, {
      [`${ROOT}/report.json`]: "{not json",
    });
    await expect(result()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("does not turn an unreadable report into a missing one", async () => {
    const { deps, result } = runFiles(handler, {});
    vi.spyOn(deps.fs, "readFile").mockRejectedValueOnce(
      fsError("EACCES", "/repo/report.json"),
    );
    await expect(result()).rejects.toMatchObject({ code: "EACCES" });
  });

  it("fails naming the flags when --package or --report is missing", async () => {
    const { deps } = depsOf({ files: REPO.files });
    expect(await callHandler(handler, deps, {})).toEqual({
      code: 1,
      stderr:
        "test-budget: pass --package <dir, such as tools/kore> and --report <json file the unit run writes>\n",
    });
  });
});
