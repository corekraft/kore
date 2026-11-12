import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { activePlan, planHarness } from "./plan-test-support.js";

const PLAN = "infra/plans/2-a.md";

const BODY = `## Step 1: Alpha

- [ ] Wire the alpha gate
- [ ] Prove the beta path
      across two lines
- [x] Done already

## Step 2: Beta

- [ ] Ship the gamma release

## Where each open item can be done

Every item sits in one class (as of 2026-11-09: 2 local, 1 managed
cluster, 1 release pipeline).

### Local

- Step 1 (2): Wire the alpha gate (offline only); Prove the beta path
  across two lines.

### Managed cluster

- Step 2 (1): Ship the gamma release.

### Release pipeline and repository settings

- Step 1 (1): Tag it.

## Step 3: After

- [ ] Later
`;

function plan(body = BODY) {
  return planHarness({ [PLAN]: activePlan(body) });
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

describe("harness plan tick plan selection", () => {
  it("refuses when several plans are active and none is named", async () => {
    const h = planHarness({
      [PLAN]: activePlan(BODY),
      "infra/plans/9-b.md": activePlan("## Step 1: C\n\n- [ ] q\n"),
    });
    expect(await run(["plan", "tick", "--item", "q"], h.deps)).toBe(1);
    expect(h.err()).toContain("--plan");
    expect(h.err()).toContain("9-b.md");
    expect(h.writes).toEqual([]);
  });

  it("ticks in the plan named by --plan when several are active", async () => {
    const h = planHarness({
      [PLAN]: activePlan(BODY),
      "infra/plans/9-b.md": activePlan("## Step 1: C\n\n- [ ] q\n"),
    });
    expect(
      await run(["plan", "tick", "--plan", "9", "--item", "q"], h.deps),
    ).toBe(0);
    expect(h.files["infra/plans/9-b.md"]).toContain("- [x] q");
    expect(h.files[PLAN]).toBe(activePlan(BODY));
  });

  it("refuses a --plan number shared by two files and writes nothing", async () => {
    const h = planHarness({
      "infra/plans/9-b.md": activePlan("## Step 1: C\n\n- [ ] q\n"),
      "infra/plans/9-c.md": activePlan("## Step 1: D\n\n- [ ] q\n"),
    });
    expect(
      await run(["plan", "tick", "--plan", "9", "--item", "q"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("9-b.md");
    expect(h.err()).toContain("9-c.md");
    expect(h.writes).toEqual([]);
  });

  it("refuses a --plan that names no plan file", async () => {
    const h = plan();
    expect(
      await run(["plan", "tick", "--plan", "7", "--item", "x"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain('No plan numbered "7"');
  });

  it("refuses when no plan is active", async () => {
    const h = planHarness({ "infra/plans/1-a.md": "---\nstatus: done\n---\n" });
    expect(await run(["plan", "tick", "--item", "x"], h.deps)).toBe(1);
    expect(h.err()).toContain("No active plan");
  });
});

describe("harness plan tick usage", () => {
  it("fails as a usage error without --item", async () => {
    const h = plan();
    expect(await run(["plan", "tick"], h.deps)).toBe(1);
    expect(h.err()).toContain("--item");
    expect(h.writes).toEqual([]);
  });

  it("fails as a usage error when a flag lacks its value", async () => {
    const h = plan();
    expect(await run(["plan", "tick", "--item"], h.deps)).toBe(2);
    expect(h.err()).toContain('Flag "--item" needs a value');
  });

  it("prints a JSON error object under --json when refusing", async () => {
    const h = plan();
    await run(["plan", "tick", "--item", "Nope", "--json"], h.deps);
    const line = h.err().split("\n")[0] ?? "";
    expect(JSON.parse(line)).toHaveProperty("error");
  });
});

describe("harness plan tick list edge cases", () => {
  it("refuses an item the plan's lists have no entry for and writes nothing", async () => {
    const h = plan(BODY.replace("- Step 2 (1): Ship the gamma release.\n", ""));
    expect(
      await run(["plan", "tick", "--item", "Ship the gamma"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("no entry for Step 2");
    expect(h.writes).toEqual([]);
  });

  it("refuses an item it cannot place in any list segment", async () => {
    const h = plan(
      BODY.replace(
        "- Step 2 (1): Ship the gamma release.",
        "- Step 2 (1): Unrelated words entirely.",
      ),
    );
    expect(
      await run(["plan", "tick", "--item", "Ship the gamma"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("Cannot tell which list entry");
    expect(h.writes).toEqual([]);
  });

  it("refuses when the totals line cannot be recounted and writes nothing", async () => {
    const h = plan(BODY.replace("1 managed\ncluster", "one managed\ncluster"));
    expect(
      await run(["plan", "tick", "--item", "Ship the gamma"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain("totals line");
    expect(h.writes).toEqual([]);
  });

  it("refuses when the entry sits under an unknown list class", async () => {
    const h = plan(BODY.replace("### Managed cluster", "### Elsewhere"));
    expect(
      await run(["plan", "tick", "--item", "Ship the gamma"], h.deps),
    ).toBe(1);
    expect(h.err()).toContain('"Elsewhere"');
    expect(h.writes).toEqual([]);
  });

  it("ticks a plan that has no open-item lists", async () => {
    const h = planHarness({
      [PLAN]: activePlan("## Step 1: A\n\n- [ ] only\n"),
    });
    expect(await run(["plan", "tick", "--item", "only"], h.deps)).toBe(0);
    expect(h.files[PLAN]).toContain("- [x] only");
  });
});
