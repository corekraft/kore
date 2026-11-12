// The kb-check hook: the same checks through the harness runner and filesystem.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";

const CLEAN = { "docs/index.md": "# Index\n", "README.md": "# Kore\n" };
const BROKEN = { ...CLEAN, "README.md": "# Kore\n\n[gone](missing.md)\n" };

function repository(tree: Record<string, string>, gitFails = false) {
  return testHarness({
    files: Object.fromEntries(
      Object.entries(tree).map(([path, text]) => [`/repo/${path}`, text]),
    ),
    responses: [
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

  it("fails open when git cannot list the files, and fails under --strict", async () => {
    const open = repository(CLEAN, true);
    expect(await run(["hook", "kb-check"], open.deps)).toBe(0);
    expect(open.err()).toMatch(/\[hook:kb-check\] failed open: git ls-files/);
    const strict = repository(CLEAN, true);
    expect(await run(["hook", "kb-check", "--strict"], strict.deps)).toBe(1);
  });
});
