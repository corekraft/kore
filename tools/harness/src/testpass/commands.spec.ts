import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import { run } from "../cli/cli.js";

const TREE = "a".repeat(40);
const OTHER = "b".repeat(40);
const RECORD = `/main/.kore/state/test-pass/${TREE}`;

function harness(files: Record<string, string> = {}) {
  return testHarness({
    files,
    env: { KORE_ROOT: "/main" },
    responses: [
      {
        match: (command, args) => command === "git" && args[0] === "write-tree",
        result: { stdout: `${TREE}\n` },
      },
    ],
  });
}

describe("harness test record", () => {
  it("records a pass for the staged tree, shared by every worktree", async () => {
    const h = harness();
    expect(await run(["test", "record"], h.deps)).toBe(0);
    expect(h.files.has(RECORD)).toBe(true);
    expect(h.out()).toContain(`recorded: tests passed at tree ${TREE}`);
  });

  it("asks git for the tree of the index in the committing worktree", async () => {
    const h = harness();
    await run(["test", "record"], h.deps);
    expect(h.runner.calls[0]).toMatchObject({
      command: "git",
      args: ["write-tree"],
      options: { cwd: "/work/tree" },
    });
  });

  it("rejects a tree that is not a full hash and writes nothing", async () => {
    const h = harness();
    expect(await run(["test", "record", "--tree", "../x"], h.deps)).toBe(1);
    expect(h.err()).toContain("--tree must be a full git tree hash");
    expect([...h.files.keys()]).toEqual([]);
  });

  it("fails with the git error when the tree cannot be read", async () => {
    const h = testHarness({
      env: { KORE_ROOT: "/main" },
      responses: [
        {
          match: (command) => command === "git",
          result: { code: 128, stderr: "unmerged entries" },
        },
      ],
    });
    expect(await run(["test", "record"], h.deps)).toBe(1);
    expect(h.err()).toContain("unmerged entries");
    expect([...h.files.keys()]).toEqual([]);
  });
});

describe("harness test check", () => {
  it("says the tests already passed and exits 0 for a recorded tree", async () => {
    const h = harness({ [RECORD]: "{}" });
    expect(await run(["test", "check"], h.deps)).toBe(0);
    expect(h.out()).toContain(`tests already passed at tree ${TREE}`);
  });

  it("exits 1 for a tree with no record, so the tests must run", async () => {
    const h = harness({ [`/main/.kore/state/test-pass/${OTHER}`]: "{}" });
    expect(await run(["test", "check"], h.deps)).toBe(1);
    expect(h.out()).toContain(`no recorded pass at tree ${TREE}`);
  });

  it("checks the tree it is given instead of the index", async () => {
    const h = harness({ [`/main/.kore/state/test-pass/${OTHER}`]: "{}" });
    expect(await run(["test", "check", "--tree", OTHER], h.deps)).toBe(0);
    expect(h.runner.calls).toEqual([]);
  });

  it("reports in JSON for a machine reader", async () => {
    const h = harness({ [RECORD]: "{}" });
    await run(["test", "check", "--json"], h.deps);
    expect(JSON.parse(h.out())).toEqual({ tree: TREE, passed: true });
  });
});
