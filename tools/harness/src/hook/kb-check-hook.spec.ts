// The kb-check hook: the same checks through the harness runner and filesystem.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";

const CLEAN = { "docs/index.md": "# Index\n", "README.md": "# Kore\n" };
const BROKEN = { ...CLEAN, "README.md": "# Kore\n\n[gone](missing.md)\n" };

/** A `git config --get core.bare` answer: a value, unset (code 1), or a failure. */
type BareAnswer = string | { code: number; stderr: string };

function bareResult(bare: BareAnswer | undefined) {
  if (bare === undefined) {
    return { code: 1 };
  }
  return typeof bare === "string" ? { stdout: `${bare}\n` } : bare;
}

function repository(
  tree: Record<string, string>,
  gitFails = false,
  bare?: BareAnswer,
) {
  return testHarness({
    files: Object.fromEntries(
      Object.entries(tree).map(([path, text]) => [`/repo/${path}`, text]),
    ),
    responses: [
      {
        match: (_, args) => args[0] === "config",
        result: bareResult(bare),
      },
      {
        match: (_, args) => args[0] === "ls-files",
        result: gitFails
          ? { code: 128, stderr: "fatal: not a git repository" }
          : { stdout: `${Object.keys(tree).join("\0")}\0` },
      },
    ],
  });
}

describe("harness hook kb-check", () => {
  it("prints the clean line then the skill audit report, exiting 0", async () => {
    const h = repository(CLEAN);
    expect(await run(["hook", "kb-check", "--strict"], h.deps)).toBe(0);
    expect(h.out()).toMatch(/^kb-check: clean\n/);
    expect(h.out()).toMatch(/\nskill audit:\n {2}NAME/);
  });

  const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
  it.each([
    ["body", `---\nname: big\ndescription: d\n---\n${long}\n`],
    [
      "description",
      `---\nname: big\ndescription: ${"d".repeat(250)}\n---\nok\n`,
    ],
  ])(
    "--strict exits 1 for a skill over its %s budget, and warn mode exits 0",
    async (_limit, text) => {
      const tree = { ...CLEAN, "skills/big/SKILL.md": text };
      const strict = repository(tree);
      expect(await run(["hook", "kb-check", "--strict"], strict.deps)).toBe(1);
      expect(strict.out()).toMatch(/big .*over-budget/);
      expect(strict.out()).toMatch(/kb-check: skill audit failed\n/);
      expect(await run(["hook", "kb-check"], repository(tree).deps)).toBe(0);
    },
  );

  it("warns on findings and exits 0, and --strict exits 1", async () => {
    const warn = repository(BROKEN);
    expect(await run(["hook", "kb-check"], warn.deps)).toBe(0);
    expect(warn.out()).toMatch(/README\.md:3: link target missing\.md/);
    expect(warn.out()).toMatch(/1 finding \(warn mode; --strict/);
    const strict = repository(BROKEN);
    expect(await run(["hook", "kb-check", "--strict"], strict.deps)).toBe(1);
  });

  it("asks git for each document's newest commit date", async () => {
    const h = repository({
      ...CLEAN,
      "infra/plans/1-a.md":
        "---\nstatus: active\nsummary: x\nlast-verified: 2026-01-01\n---\n[r](../../README.md)\n",
    });
    await run(["hook", "kb-check"], h.deps);
    expect(
      h.runner.calls.some((call) => call.args.includes("--format=%cs")),
    ).toBe(true);
  });

  it("exits 1 and says it failed when git cannot list the files, so no check passes unrun", async () => {
    const open = repository(CLEAN, true);
    expect(await run(["hook", "kb-check"], open.deps)).toBe(1);
    expect(open.err()).toMatch(/\[hook:kb-check\] failed: git ls-files/);
    const strict = repository(CLEAN, true);
    expect(await run(["hook", "kb-check", "--strict"], strict.deps)).toBe(1);
  });
});

describe("harness hook kb-check core.bare", () => {
  it("reports core.bare true in the shared git config, and --strict exits 1", async () => {
    const warn = repository(CLEAN, false, "true");
    expect(await run(["hook", "kb-check"], warn.deps)).toBe(0);
    expect(warn.out()).toMatch(
      /core\.bare is true.*git config core\.bare false/,
    );
    expect(warn.out()).toMatch(/kb-check: 1 finding \(warn mode/);
    const strict = repository(CLEAN, false, "true");
    expect(await run(["hook", "kb-check", "--strict"], strict.deps)).toBe(1);
    expect(strict.out()).toMatch(/kb-check: 1 finding\n/);
    expect(strict.out()).not.toMatch(/kb-check: clean/);
  });

  it("stays clean when core.bare is false or unset", async () => {
    for (const bare of ["false", undefined]) {
      const h = repository(CLEAN, false, bare);
      expect(await run(["hook", "kb-check", "--strict"], h.deps)).toBe(0);
      expect(h.out()).toMatch(/^kb-check: clean\n/);
      expect(h.out()).not.toMatch(/core\.bare/);
    }
  });

  it("fails rather than reporting clean when git cannot read core.bare", async () => {
    const unreadable = { code: 128, stderr: "fatal: bad config line 1" };
    for (const args of [
      ["hook", "kb-check"],
      ["hook", "kb-check", "--strict"],
    ]) {
      const h = repository(CLEAN, false, unreadable);
      expect(await run(args, h.deps)).toBe(1);
      expect(h.err()).toMatch(
        /\[hook:kb-check\] failed: git config --get core\.bare failed: fatal: bad config line 1/,
      );
      expect(h.out()).not.toMatch(/kb-check: clean/);
    }
  });

  it("reads core.bare from the repository root, without writing config", async () => {
    const h = repository(CLEAN);
    await run(["hook", "kb-check"], h.deps);
    const config = h.runner.calls.filter((c) => c.args[0] === "config");
    expect(config.map((c) => c.args)).toEqual([
      ["config", "--get", "core.bare"],
    ]);
    expect(config[0]?.options?.cwd).toBe("/repo");
  });
});
