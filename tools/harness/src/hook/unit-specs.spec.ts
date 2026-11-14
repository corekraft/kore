// The unit-spec check, through its entry point: the command the host runs as
// `harness hook unit-specs`. The unit is the check; the hook wrapper and the
// unconverted-list helpers the budget also reads are mocked.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "./io.js";
import { isListed, readLists } from "./test-budget.js";
import "./unit-specs.js";
import {
  ROOT,
  SRC,
  callHandler,
  depsOf,
  type Handler,
  type World,
} from "./test-budget-support.js";

vi.mock("./io.js");
vi.mock("./test-budget.js");

/**
 * The wrapper is automocked, so its calls keep the name, flags and handler each
 * command registered. Loading the budget module, which is automocked too,
 * registers that command first, so this picks the check's call by name.
 */
const [name, summary, handler, shape] = vi
  .mocked(hookCommand)
  .mock.calls.find(([called]) => called === "unit-specs") as Parameters<
  typeof hookCommand
>;

/** A fake repository: each path is a file under the package's src, and every directory above it exists. */
function tree(...paths: string[]): World {
  const files: Record<string, string> = {};
  for (const path of paths) {
    files[`${SRC}/${path}`] = "";
    const dirs = path.split("/").slice(0, -1);
    for (let i = 1; i <= dirs.length; i++) {
      files[`${SRC}/${dirs.slice(0, i).join("/")}/`] = "";
    }
  }
  return { files };
}

/** Runs the check over a fake repository, with the given paths listed as unconverted. */
async function run(
  world: World,
  listed: string[] = [],
  options: Record<string, string | boolean> = { package: "tools/kore" },
) {
  vi.mocked(readLists).mockResolvedValue(new Map());
  vi.mocked(isListed).mockImplementation((_lists, _srcDir, source) =>
    listed.some((path) => source === `${SRC}/${path}`),
  );
  const { deps } = depsOf(world);
  const result = await callHandler(handler as Handler, deps, options);
  return {
    code: result.code ?? 0,
    out: result.stdout ?? "",
    err: result.stderr ?? "",
  };
}

describe("harness hook unit-specs: registration", () => {
  it("registers as unit-specs with its package flag, ignoring stdin, and failing the run when the check itself breaks", () => {
    expect(name).toBe("unit-specs");
    expect(summary).toMatch(/^fail a converted source file/);
    expect(shape).toEqual({
      flags: { package: "string" },
      payload: false,
      faultCode: 1,
    });
  });

  it("asks for the package when none is given", async () => {
    const { code, err } = await run(tree("security/scan.ts"), [], {});
    expect(code).toBe(1);
    expect(err).toBe("unit-specs: pass --package <dir, such as tools/kore>\n");
  });
});

describe("harness hook unit-specs: one spec per unit", () => {
  it("fails a converted source file with no spec beside it, naming the file", async () => {
    const { code, err } = await run(tree("security/scan.ts"));
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/security/scan.ts has no spec; add scan.spec.ts beside it (ADR 0098)\n",
    );
  });

  it("fails a converted source file with two specs beside it, naming both and the one to keep", async () => {
    const { code, err } = await run(
      tree(
        "security/scan.ts",
        "security/scan.spec.ts",
        "security/scan.test.ts",
      ),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/security/scan.ts has two specs, scan.spec.ts and scan.test.ts; keep only scan.spec.ts (ADR 0098)\n",
    );
  });

  it("fails a converted source file whose only spec is named .test.ts, since the unit run reads .spec.ts", async () => {
    const { code, err } = await run(
      tree("security/scan.ts", "security/scan.test.ts"),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/security/scan.ts has no spec; add scan.spec.ts beside it (ADR 0098)\n",
    );
  });

  it("passes a converted source file with exactly one spec beside it", async () => {
    const { code, err } = await run(
      tree("security/scan.ts", "security/scan.spec.ts"),
    );
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("names every converted file without a spec, in every domain, and nothing for the others", async () => {
    const { code, err } = await run(
      tree(
        "security/scan.ts",
        "security/scan.spec.ts",
        "images/pin.ts",
        "images/pin2.ts",
      ),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      [
        "unit-specs: tools/kore/src/images/pin.ts has no spec; add pin.spec.ts beside it (ADR 0098)",
        "unit-specs: tools/kore/src/images/pin2.ts has no spec; add pin2.spec.ts beside it (ADR 0098)",
        "",
      ].join("\n"),
    );
  });

  it("checks a source file in a nested directory against the spec beside it", async () => {
    const { code, err } = await run(
      tree(
        "security/deep/a.ts",
        "security/deep/b.ts",
        "security/deep/b.spec.ts",
      ),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/security/deep/a.ts has no spec; add a.spec.ts beside it (ADR 0098)\n",
    );
  });
});

describe("harness hook unit-specs: unconverted files", () => {
  it("does not report a listed file that has no spec", async () => {
    const { code, err } = await run(tree("security/old.ts"), [
      "security/old.ts",
    ]);
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("does not report a listed file that has two specs", async () => {
    const { code } = await run(
      tree("security/old.ts", "security/old.spec.ts", "security/old.test.ts"),
      ["security/old.ts"],
    );
    expect(code).toBe(0);
  });
});

describe("harness hook unit-specs: what is not a unit", () => {
  it("exempts support and fixture files by name, which need no spec", async () => {
    const { code, err } = await run(
      tree(
        "security/scan-support.ts",
        "security/rows-fixtures.ts",
        "security/rows.fixtures.ts",
        "security/types.d.ts",
      ),
    );
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("does not count a live or docker spec as the unit's spec", async () => {
    const { code, err } = await run(
      tree(
        "security/scan.ts",
        "security/scan.live.spec.ts",
        "security/scan.docker.spec.ts",
      ),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/security/scan.ts has no spec; add scan.spec.ts beside it (ADR 0098)\n",
    );
  });

  it("does not report a spec with no source file beside it", async () => {
    const { code } = await run(tree("security/orphan.spec.ts"));
    expect(code).toBe(0);
  });

  it("does not count a spec whose name only starts with the source's name", async () => {
    const { code, err } = await run(
      tree("runtime/runner.ts", "runtime/runner.cancel.spec.ts"),
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "unit-specs: tools/kore/src/runtime/runner.ts has no spec; add runner.spec.ts beside it (ADR 0098)\n",
    );
  });
});

describe("harness hook unit-specs: the source root", () => {
  it("reads the package's src under the repository root", async () => {
    const { deps } = depsOf(tree("security/scan.ts", "security/scan.spec.ts"));
    await callHandler(handler as Handler, deps, { package: "tools/kore" });
    expect(vi.mocked(readLists)).toHaveBeenCalledWith(
      deps,
      `${ROOT}/tools/kore/src`,
    );
  });
});
