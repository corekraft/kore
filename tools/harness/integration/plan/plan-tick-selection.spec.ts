import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import {
  TICK_BODY as BODY,
  TICK_PLAN_FILE as PLAN,
  activePlan,
  planHarness,
  tickPlan as plan,
} from "../../src/testing/index.js";

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
