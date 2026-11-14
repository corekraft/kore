import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { PLAN, plan } from "./plan-tick-support.js";

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

describe("harness plan tick", () => {
  it("ticks the item, drops it from its list, and recounts the list and totals", async () => {
    const h = plan();
    expect(
      await run(["plan", "tick", "--item", "Wire the alpha gate"], h.deps),
    ).toBe(0);
    const after = h.files[PLAN] ?? "";
    expect(after).toContain("- [x] Wire the alpha gate");
    expect(after).toContain(
      "- Step 1 (1): Prove the beta path\n  across two lines.",
    );
    expect(after).toContain("(as of 2026-01-02: 1 local, 1 managed");
    expect(after).toContain("- Step 1 (1): Tag it.");
    expect(h.writes).toEqual([PLAN]);
  });

  it("changes only the lines the JSON report names", async () => {
    const h = plan();
    const before = h.files[PLAN] ?? "";
    expect(
      await run(
        ["plan", "tick", "--item", "Prove the beta path", "--json"],
        h.deps,
      ),
    ).toBe(0);
    const report = JSON.parse(h.out()) as {
      plan: string;
      written: boolean;
      changes: Change[];
    };
    expect(report.plan).toBe(PLAN);
    expect(report.written).toBe(true);
    expect(report.changes.length).toBeGreaterThanOrEqual(2);
    expect(applyChanges(before, report.changes)).toBe(h.files[PLAN]);
    const reported = new Set(report.changes.flatMap((c) => c.before));
    const kept = before.split("\n").filter((line) => !reported.has(line));
    expect(kept.length).toBeGreaterThan(10);
    for (const line of kept) {
      expect(h.files[PLAN]?.split("\n")).toContain(line);
    }
  });
});

describe("harness plan tick output", () => {
  it("stamps the as-of date with the local day just before UTC midnight west of UTC", async () => {
    const zone = process.env["TZ"];
    process.env["TZ"] = "America/Los_Angeles";
    try {
      const h = plan();
      h.deps.clock = {
        now: () => new Date("2026-03-02T07:59:00Z"),
        sleep: () => Promise.resolve(),
      };
      await run(["plan", "tick", "--item", "Ship the gamma"], h.deps);
      expect(h.files[PLAN]).toContain("(as of 2026-03-01: 2 local");
    } finally {
      if (zone === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = zone;
      }
    }
  });

  it("removes a list entry whose count reaches zero", async () => {
    const h = plan();
    await run(["plan", "tick", "--item", "Ship the gamma"], h.deps);
    expect(h.files[PLAN]).not.toContain("- Step 2 (1)");
    expect(h.files[PLAN]).toContain("(as of 2026-01-02: 2 local, 0 managed");
  });

  it("reports the diff without writing under --dry-run", async () => {
    const h = plan();
    const before = h.files[PLAN];
    expect(
      await run(
        ["plan", "tick", "--item", "Ship the gamma", "--dry-run", "--json"],
        h.deps,
      ),
    ).toBe(0);
    const report = JSON.parse(h.out()) as {
      dryRun: boolean;
      written: boolean;
    };
    expect(report).toMatchObject({ dryRun: true, written: false });
    expect(h.files[PLAN]).toBe(before);
    expect(h.writes).toEqual([]);
  });

  it("prints the changed lines in text", async () => {
    const h = plan();
    await run(["plan", "tick", "--item", "Ship the gamma"], h.deps);
    expect(h.out()).toContain("Ticked Step 2");
    expect(h.out()).toContain("- - [ ] Ship the gamma release");
    expect(h.out()).toContain("+ - [x] Ship the gamma release");
  });

  it("says it would tick under --dry-run in text", async () => {
    const h = plan();
    await run(
      ["plan", "tick", "--item", "Ship the gamma", "--dry-run"],
      h.deps,
    );
    expect(h.out()).toContain("Would tick Step 2");
  });
});

describe("harness plan tick refusals", () => {
  it("refuses an item matching no open item and writes nothing", async () => {
    const h = plan();
    expect(
      await run(["plan", "tick", "--item", "Nonexistent thing"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("matches no open item");
    expect(h.err()).toContain("harness plan active");
    expect(h.writes).toEqual([]);
  });

  it("says when the item is already ticked", async () => {
    const h = plan();
    expect(await run(["plan", "tick", "--item", "Done already"], h.deps)).toBe(
      1,
    );
    expect(h.err()).toContain("already ticked");
    expect(h.writes).toEqual([]);
  });

  it("refuses an item matching several open items and writes nothing", async () => {
    const h = plan();
    expect(await run(["plan", "tick", "--item", "the"], h.deps)).toBe(1);
    expect(h.err()).toContain("matches 3 open items");
    expect(h.err()).toContain("longer");
    expect(h.writes).toEqual([]);
  });
});
