// The test-budget hook's package-run limit and its domains without a list, through
// the entry point: the command the host runs as `harness hook test-budget`. The
// unit is the hook; the hook wrapper is mocked. Split from test-budget.spec.ts
// to keep each spec under 300 lines.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import { hookCommand } from "./io.js";
import { isListed, readLists } from "./test-budget.js";
import {
  SRC,
  depsOf,
  one,
  runHook,
  twoDomains,
  withList,
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

describe("harness hook test-budget: package run", () => {
  const slowRun: Spec[] = [
    one("security/scan.spec.ts", "a", 1),
    one("images/pin.spec.ts", "a", 1),
    one("images/pin2.spec.ts", "a", 1),
  ];

  it("fails a run over 120 seconds once every list is empty", async () => {
    const world = twoDomains({ security: "" });
    const { code, err } = await run(world, slowRun, {}, 121_300);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: the tools/kore unit run took 121300 ms, 1300 ms over the 120000 ms package budget, startup and global setup included; the slowest specs are printed above, so speed those up or split them (ADR 0098)\n",
    );
  });

  it("passes a 26 second run, which the former 20 second limit failed", async () => {
    const { code, err } = await run(
      twoDomains({ security: "" }),
      slowRun,
      {},
      26_000,
    );
    expect(code).toBe(0);
    expect(err).toBe("");
  });

  it("does not apply the 120 second limit while any list still names a file", async () => {
    const world = twoDomains({ security: "scan.ts\n" });
    const { code, err } = await run(world, slowRun, {}, 121_300);
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});

describe("harness hook test-budget: missing and header-only lists", () => {
  const domainOnly: World = {
    files: {
      [`${SRC}/`]: "",
      [`${SRC}/security/`]: "",
      [`${SRC}/security/scan.ts`]: "",
    },
  };
  const headerOnly = "# Source files not yet converted to unit tests.\n";

  it("reads a domain with no list as naming no file, the same as a list holding only its header", async () => {
    const missing = await readLists(depsOf(domainOnly).deps, SRC);
    expect([...missing.entries()]).toEqual([]);

    const withHeader = depsOf({
      files: {
        ...domainOnly.files,
        [`${SRC}/security/unconverted.txt`]: headerOnly,
      },
    }).deps;
    const empty = await readLists(withHeader, SRC);
    expect([...empty.entries()]).toEqual([
      [`${SRC}/security/unconverted.txt`, []],
    ]);

    const source = `${SRC}/security/scan.ts`;
    expect(isListed(missing, SRC, source)).toBe(false);
    expect(isListed(empty, SRC, source)).toBe(false);
  });

  it("budgets a domain whose list holds only its header the same as one with no list", async () => {
    const { code, err } = await run(withList(headerOnly), [
      one("security/scan.spec.ts", "scans", 154),
    ]);
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: tools/kore/src/security/scan.spec.ts > scans took 154 ms, 54 ms over the 100 ms test budget; mock what it imports and drop real timers and processes, so it tests one unit alone (ADR 0098)\n",
    );
  });

  it("applies the 120 second package limit when no domain has a list at all", async () => {
    const { code, err } = await run(
      twoDomains({}),
      [
        one("security/scan.spec.ts", "a", 1),
        one("images/pin.spec.ts", "a", 1),
        one("images/pin2.spec.ts", "a", 1),
      ],
      {},
      121_300,
    );
    expect(code).toBe(1);
    expect(err).toBe(
      "test-budget: the tools/kore unit run took 121300 ms, 1300 ms over the 120000 ms package budget, startup and global setup included; the slowest specs are printed above, so speed those up or split them (ADR 0098)\n",
    );
  });
});
