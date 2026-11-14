import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { activePlan, planHarness } from "../../src/testing/index.js";

const PLAN = "infra/plans/2-a.md";

const BODY = `## Step 1: Alpha

- [x] Done already

## Step 2: Beta

Next: old line
  that wraps.

- [ ] Ship the gamma release
- [ ] Ship the delta release

## Step 3: After

- [ ] Later
`;

function plan(body = BODY) {
  return planHarness({ [PLAN]: activePlan(body) });
}

function nextLines(markdown: string): string[] {
  return markdown.split("\n").filter((l) => l.startsWith("Next:"));
}

interface Change {
  line: number;
  before: string[];
  after: string[];
}

function applyChanges(before: string, changes: Change[]): string {
  const lines = before.split("\n");
  for (const c of [...changes].sort((a, b) => b.line - a.line)) {
    expect(lines.slice(c.line - 1, c.line - 1 + c.before.length)).toEqual(
      c.before,
    );
    lines.splice(c.line - 1, c.before.length, ...c.after);
  }
  return lines.join("\n");
}

describe("harness plan next", () => {
  it("leaves exactly one Next: line, directly under the current step heading", async () => {
    const h = plan();
    expect(
      await run(["plan", "next", "--text", "Run the gamma test"], h.deps),
    ).toBe(0);
    const after = h.files[PLAN] ?? "";
    expect(nextLines(after)).toEqual(["Next: Run the gamma test"]);
    expect(after).toContain(
      "## Step 2: Beta\n\nNext: Run the gamma test\n\n- [ ] Ship the gamma release",
    );
    expect(after).not.toContain("old line");
    expect(after).not.toContain("that wraps");
  });

  it("moves the Next: line to the first step with open items when its step is finished", async () => {
    const h = plan(
      BODY.replace("- [ ] Ship the gamma", "- [x] Ship the gamma").replace(
        "- [ ] Ship the delta",
        "- [x] Ship the delta",
      ),
    );
    await run(["plan", "next", "--text", "Start step 3"], h.deps);
    const after = h.files[PLAN] ?? "";
    expect(nextLines(after)).toEqual(["Next: Start step 3"]);
    expect(after).toContain(
      "## Step 3: After\n\nNext: Start step 3\n\n- [ ] Later",
    );
  });

  it("adds a Next: line when the plan has none, under the first step with open items", async () => {
    const h = plan(BODY.replace("Next: old line\n  that wraps.\n\n", ""));
    await run(["plan", "next", "--text", "Begin"], h.deps);
    expect(h.files[PLAN]).toContain(
      "## Step 2: Beta\n\nNext: Begin\n\n- [ ] Ship the gamma release",
    );
  });

  it("changes only the lines the JSON report names", async () => {
    const h = plan();
    const before = h.files[PLAN] ?? "";
    await run(["plan", "next", "--text", "New", "--json"], h.deps);
    const report = JSON.parse(h.out()) as {
      written: boolean;
      changes: Change[];
    };
    expect(report.written).toBe(true);
    expect(applyChanges(before, report.changes)).toBe(h.files[PLAN]);
  });

  it("writes nothing under --dry-run but reports the same lines", async () => {
    const h = plan();
    const before = h.files[PLAN];
    await run(["plan", "next", "--text", "New", "--dry-run"], h.deps);
    expect(h.files[PLAN]).toBe(before);
    expect(h.writes).toEqual([]);
    expect(h.out()).toContain("Would set");
    expect(h.out()).toContain("+ Next: New");
  });
});

describe("harness plan next edge cases", () => {
  it("collapses a Next: line placed under the wrong step and does not duplicate it", async () => {
    const h = plan(
      BODY.replace("## Step 3: After\n", "## Step 3: After\n\nNext: stray\n"),
    );
    await run(["plan", "next", "--text", "Only"], h.deps);
    expect(nextLines(h.files[PLAN] ?? "")).toEqual(["Next: Only"]);
  });

  it("rejects missing text, and a plan with no open item, before writing", async () => {
    const h = plan();
    expect(await run(["plan", "next"], h.deps)).toBe(1);
    expect(h.err()).toContain("--text");
    const done = plan("## Step 1: A\n\n- [x] Done\n");
    expect(await run(["plan", "next", "--text", "x"], done.deps)).toBe(1);
    expect(done.err()).toContain("no open item");
    expect(done.writes).toEqual([]);
  });
});

describe("harness plan clear-next", () => {
  it("leaves no Next: line and no wrapped remainder", async () => {
    const h = plan();
    expect(await run(["plan", "clear-next"], h.deps)).toBe(0);
    const after = h.files[PLAN] ?? "";
    expect(nextLines(after)).toEqual([]);
    expect(after).not.toContain("that wraps");
    expect(after).toContain("## Step 2: Beta\n\n- [ ] Ship the gamma release");
  });

  it("reports changed lines equal to the diff", async () => {
    const h = plan();
    const before = h.files[PLAN] ?? "";
    await run(["plan", "clear-next", "--json"], h.deps);
    const report = JSON.parse(h.out()) as { changes: Change[] };
    expect(applyChanges(before, report.changes)).toBe(h.files[PLAN]);
  });

  it("is a no-op that writes nothing when there is no Next: line", async () => {
    const h = plan(BODY.replace("Next: old line\n  that wraps.\n\n", ""));
    expect(await run(["plan", "clear-next"], h.deps)).toBe(0);
    expect(h.writes).toEqual([]);
    expect(h.out()).toContain("No Next:");
  });

  it("keeps a list that follows a Next: line with no blank line between", async () => {
    const h = plan(
      "## Step 1: A\n\nNext: old\n- [ ] one\n- [ ] two\n\n## Step 2: B\n\n- [ ] x\n",
    );
    await run(["plan", "clear-next"], h.deps);
    const after = h.files[PLAN] ?? "";
    expect(after).toContain("- [ ] one\n- [ ] two");
    expect(after).not.toContain("Next:");
  });
});

describe("harness plan next and code fences", () => {
  const FENCED =
    "## Step 1: A\n\nNext: real\n\n```\nNext: example in a fence\n```\n\n- [ ] one\n";

  it("leaves a Next: line inside a code fence untouched when setting and clearing", async () => {
    const h = plan(FENCED);
    await run(["plan", "next", "--text", "new"], h.deps);
    expect(h.files[PLAN]).toContain("Next: new\n");
    expect(h.files[PLAN]).toContain("```\nNext: example in a fence\n```");
    expect(h.files[PLAN]).not.toContain("Next: real");
    await run(["plan", "clear-next"], h.deps);
    expect(h.files[PLAN]).toContain("```\nNext: example in a fence\n```");
    expect(nextLines(h.files[PLAN] ?? "")).toEqual([
      "Next: example in a fence",
    ]);
  });

  it("stops removing a Next: line at a code fence", async () => {
    const h = plan("## Step 1: A\n\nNext: real\n```\ncode\n```\n\n- [ ] one\n");
    await run(["plan", "clear-next"], h.deps);
    expect(h.files[PLAN]).toContain("```\ncode\n```");
    expect(h.files[PLAN]).not.toContain("Next: real");
  });

  it("does not leave two blank lines when replacing a Next: line directly under its heading", async () => {
    const h = plan("## Step 1: A\nNext: old\n\n- [ ] one\n");
    await run(["plan", "next", "--text", "new"], h.deps);
    expect(h.files[PLAN]).not.toContain("\n\n\n");
    expect(h.files[PLAN]).toContain("## Step 1: A\n\nNext: new\n\n- [ ] one");
  });
});
