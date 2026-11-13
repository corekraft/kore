// The test-budget hook, through its entry point: the command the host runs as
// `harness hook test-budget`. The unit is the hook; the hook wrapper is mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { testBudgetHook } from "./test-budget.js";
import {
  REPO,
  ROOT,
  SRC,
  depsOf,
  reportOf,
  runHook,
  type Spec,
  type World,
} from "./test-budget-support.js";

/** The wrapper stands as the host would drive it: the handler's result becomes output and an exit code. */
vi.mock("./io.js", () => ({
  hookCommand: (
    _name: string,
    summary: string,
    handler: (context: unknown) => Promise<{
      code?: number;
      stdout?: string;
      stderr?: string;
    }>,
  ) => ({
    summary,
    run: async (context: CommandContext) => {
      const result = await handler({
        deps: context.deps,
        options: context.options,
        operand: context.operand,
        payload: undefined,
      });
      if (result.stdout) {
        context.deps.stdout(result.stdout);
      }
      if (result.stderr) {
        context.deps.stderr(result.stderr);
      }
      return result.code ?? 0;
    },
  }),
}));

describe("harness hook test-budget: tests", () => {
  it("fails a slow test for a converted file, naming the test and its time", async () => {
    const { code, err } = await runHook(REPO, [
      {
        path: "security/scan.spec.ts",
        cases: [{ title: "scans", duration: 154 }],
      },
    ]);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/scan.spec.ts > scans took 154 ms, 54 ms over the 100 ms test budget\n",
    );
  });

  it("does not fail a slow test for a listed file, and still prints it among the slowest", async () => {
    const { code, out, err } = await runHook(REPO, [
      {
        path: "security/old.spec.ts",
        cases: [{ title: "walks", duration: 900 }],
      },
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
    const { out } = await runHook(REPO, [
      { path: "security/scan.spec.ts", cases },
    ]);
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
    const { code, err } = await runHook(REPO, [
      {
        path: "security/scan.spec.ts",
        cases: [{ title: "scans", duration: 5 }],
        span: [0, 1250],
      },
    ]);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/scan.spec.ts took 1250 ms, 250 ms over the 1000 ms spec file budget\n",
    );
  });

  it("does not fail a listed spec file over one second", async () => {
    const { code } = await runHook(REPO, [
      {
        path: "security/old.spec.ts",
        cases: [{ title: "walks", duration: 5 }],
        span: [0, 4000],
      },
    ]);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: lists", () => {
  it("fails a list that names a file that does not exist, so lists cannot rot", async () => {
    const { code, err } = await runHook(
      {
        files: {
          ...REPO.files,
          [`${SRC}/security/unconverted.txt`]: "old.ts\ngone.ts\n",
        },
      },
      [],
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/unconverted.txt names gone.ts, which does not exist; remove the line\n",
    );
  });

  it("ignores blank lines and comments in a list", async () => {
    const { code } = await runHook(
      {
        files: {
          ...REPO.files,
          [`${SRC}/security/unconverted.txt`]: "# batch 1\n\nold.ts\n",
        },
      },
      [],
    );
    expect(code).toBe(0);
  });

  it("does not budget a spec that has no source file beside it", async () => {
    const { code } = await runHook(REPO, [
      {
        path: "security/orphan.spec.ts",
        cases: [{ title: "x", duration: 800 }],
      },
    ]);
    expect(code).toBe(0);
  });
});

describe("harness hook test-budget: domains", () => {
  it("budgets a spec in a nested directory against the domain's list", async () => {
    const world: World = {
      files: {
        ...REPO.files,
        [`${SRC}/security/deep/`]: "",
        [`${SRC}/security/deep/a.ts`]: "",
        [`${SRC}/security/deep/a.spec.ts`]: "",
        [`${SRC}/security/unconverted.txt`]: "old.ts\ndeep/a.ts\n",
      },
    };
    const listed = await runHook(world, [
      {
        path: "security/deep/a.spec.ts",
        cases: [{ title: "a", duration: 500 }],
      },
    ]);
    expect(listed.code).toBe(0);
    const unlisted = await runHook(
      {
        files: {
          ...world.files,
          [`${SRC}/security/unconverted.txt`]: "old.ts\n",
        },
      },
      [
        {
          path: "security/deep/a.spec.ts",
          cases: [{ title: "a", duration: 500 }],
        },
      ],
    );
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
    const { code } = await runHook(world, [
      { path: "images/pin.spec.ts", cases: [{ title: "pins", duration: 101 }] },
    ]);
    expect(code).toBe(1);
  });
});

describe("harness hook test-budget: package run", () => {
  {
    const quick = [{ title: "a", duration: 1 }];
    const slowRun: Spec[] = [
      { path: "security/scan.spec.ts", cases: quick, span: [0, 900] },
      { path: "images/pin.spec.ts", cases: quick, span: [10_000, 10_900] },
      { path: "images/pin2.spec.ts", cases: quick, span: [20_500, 21_300] },
    ];
    const world = (lists: Record<string, string>): World => ({
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

    it("fails a run over 20 seconds once every list is empty", async () => {
      const { code, err } = await runHook(world({ security: "" }), slowRun);
      expect(code).toBe(1);
      expect(err).toBe(
        "test-budget: the tools/kore unit run took 21300 ms, 1300 ms over the 20000 ms package budget\n",
      );
    });

    it("does not apply the 20 second limit while any list still names a file", async () => {
      const { code, err } = await runHook(
        world({ security: "scan.ts\n" }),
        slowRun,
      );
      expect(code).toBe(0);
      expect(err).toBe("");
    });
  }
});

describe("harness hook test-budget: inputs", () => {
  it("reads a relative report path from the working directory", async () => {
    const { deps } = depsOf({
      files: {
        ...REPO.files,
        [`${ROOT}/tools/kore/out/unit.json`]: reportOf([]),
      },
    });
    const code = await testBudgetHook.run({
      deps,
      json: false,
      options: { package: "tools/kore", report: "out/unit.json" },
    } as CommandContext);
    expect(code).toBe(0);
  });

  it("fails with the fix when the report is missing, instead of passing", async () => {
    const { deps, err } = depsOf({ files: REPO.files });
    const code = await testBudgetHook.run({
      deps,
      json: false,
      options: { package: "tools/kore", report: `${ROOT}/missing.json` },
    } as CommandContext);
    expect(code).toBe(1);
    expect(err()).toMatch(
      /test-budget: no unit report at \/repo\/missing\.json; run the unit tests with --reporter=json --outputFile=/,
    );
  });

  it("fails naming the flags when --package or --report is missing", async () => {
    const { deps, err } = depsOf({ files: REPO.files });
    const code = await testBudgetHook.run({
      deps,
      json: false,
      options: {},
    } as CommandContext);
    expect(code).toBe(1);
    expect(err()).toBe(
      "test-budget: pass --package <dir, such as tools/kore> and --report <vitest json file>\n",
    );
  });
});
