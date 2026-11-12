import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { activePlan, planHarness } from "./plan-test-support.js";

const PLAN = "infra/plans/2-a.md";

function plan(body: string) {
  return planHarness({ [PLAN]: activePlan(body) });
}

describe("harness plan tick exit criteria in a list entry", () => {
  const body = `## Step 1: A

- [ ] First item here
- [ ] Second item here
- [ ] Criterion alpha holds
- [ ] Criterion beta holds
- [ ] Criterion gamma holds

## Where each open item can be done

### Local

- Step 1 (5): First item here; Second item here (offline); and three exit
  criteria: Criterion alpha holds; Criterion beta holds; Criterion gamma holds.
`;
  const tick = async (...items: string[]) => {
    const h = plan(body);
    for (const item of items) {
      expect(await run(["plan", "tick", "--item", item], h.deps)).toBe(0);
    }
    return h.files[PLAN] ?? "";
  };

  it("lowers the exit-criteria count when a later criterion is ticked", async () => {
    const after = await tick("Criterion beta holds");
    expect(after).toContain("- Step 1 (4):");
    expect(after).toContain(
      "and two exit\n  criteria: Criterion alpha holds; Criterion gamma holds.",
    );
  });

  it("hands the exit-criteria lead to the next criterion when the first is ticked", async () => {
    const after = await tick("Criterion alpha holds");
    expect(after).toContain(
      "and two exit\n  criteria: Criterion beta holds; Criterion gamma holds.",
    );
  });

  it("singularises the lead at one criterion and drops it with the last", async () => {
    const one = await tick("Criterion alpha holds", "Criterion beta holds");
    expect(one).toContain("and one exit\n  criterion: Criterion gamma holds.");
    const none = await tick(
      "Criterion alpha holds",
      "Criterion beta holds",
      "Criterion gamma holds",
    );
    expect(none).toContain(
      "- Step 1 (2): First item here; Second item here (offline).",
    );
  });

  it("removes a plain segment ahead of the exit criteria", async () => {
    const after = await tick("First item here");
    expect(after).toContain(
      "- Step 1 (4): Second item here (offline); and three exit",
    );
  });
});

describe("harness plan tick ambiguous list placement", () => {
  const words =
    "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
  const lists = (entry: string) => `## Step 1: A

- [ ] ${words}
- [ ] Other thing entirely

## Where each open item can be done

### Local

- Step 1 (2): ${entry}
`;

  it("refuses when the runner-up segment also scores close to the best", async () => {
    const near = words.replace("juliet", "kilo");
    const h = plan(lists(`${words}; ${near}`));
    expect(await run(["plan", "tick", "--item", "alpha bravo"], h.deps)).toBe(
      1,
    );
    expect(h.err()).toContain("Cannot tell which list entry");
    expect(h.writes).toEqual([]);
  });

  it("places the item when the runner-up is clearly worse", async () => {
    const h = plan(lists(`${words}; Other thing entirely`));
    expect(await run(["plan", "tick", "--item", "alpha bravo"], h.deps)).toBe(
      0,
    );
    expect(h.files[PLAN]).toContain("- Step 1 (1): Other thing entirely\n");
  });
});

describe("harness plan tick shared notes", () => {
  const body = `## Step 1: A

- [ ] First thing here
- [ ] Second thing here
- [ ] Third thing here

## Where each open item can be done

### Local

- Step 1 (3): First thing here; Second thing here (both offline only); Third
  thing here.
`;

  it("refuses to drop an item that a 'both' note covers and writes nothing", async () => {
    const h = plan(body);
    expect(await run(["plan", "tick", "--item", "Second thing"], h.deps)).toBe(
      1,
    );
    expect(h.err()).toContain("(both offline only)");
    expect(h.err()).toContain("by hand");
    expect(h.writes).toEqual([]);
  });

  it("refuses to drop the item just before a 'both' note, which the note also covers", async () => {
    const h = plan(body);
    expect(await run(["plan", "tick", "--item", "First thing"], h.deps)).toBe(
      1,
    );
    expect(h.writes).toEqual([]);
  });

  it("drops an item the note does not cover", async () => {
    const h = plan(body);
    expect(await run(["plan", "tick", "--item", "Third thing"], h.deps)).toBe(
      0,
    );
    expect(h.files[PLAN]).toContain(
      "- Step 1 (2): First thing here; Second thing here (both offline only).",
    );
  });
});
