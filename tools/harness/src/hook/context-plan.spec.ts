// The plan parser and retrospective helpers the context hook shares with the
// rest of the harness, ported from .claude/hooks/context.test.mjs.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { describe, expect, it } from "vitest";
import {
  activePlans,
  nextStep,
  openItems,
  upcomingSteps,
} from "../plan/index.js";
import { fourSteps, frontmatter, handedOff, plan } from "./context-support.js";
import { lastRetrospective, windowStart } from "./retro-scan.js";

describe("context on the shared plan parser", () => {
  it("openItems lists unchecked items with their step and joins wrapped lines", () => {
    expect(openItems(plan)).toEqual([
      "Step 2: Open: - [ ] **Bound output.** Cap hook output at 40 lines.",
      "Step 2: Open: - [ ] A large report is bounded.",
    ]);
  });

  it("activePlans picks the highest-numbered plan that still has open items", () => {
    const plans = {
      "1-initialize.md": "## Step 1: A\n\n- [ ] old open item\n",
      "2-implementation.md": "## Step 1: B\n\n- [ ] newer open item\n",
      "3-agent-harness.md": "## Step 1: C\n\n- [x] all done\n",
    };
    expect(activePlans(plans)).toEqual(["2-implementation.md"]);
    expect(activePlans({ "1-a.md": "- [x] done\n" })).toEqual([]);
  });

  it("nextStep returns the plan's Next: line with its step, joining wrapped lines", () => {
    expect(nextStep(handedOff)).toEqual({
      step: "Step 9: Operator Load",
      text: "write the statusline tests, then wire it into settings.",
    });
    expect(nextStep(plan)).toBeNull();
  });

  it("upcomingSteps lists the next three open steps after the current one, skipping finished steps", () => {
    expect(upcomingSteps(fourSteps)).toEqual([
      "Step 3: Third",
      "Step 5: Fifth",
      "Step 6: Sixth",
    ]);
  });

  it("upcomingSteps counts from the step holding the Next: line", () => {
    expect(upcomingSteps(handedOff)).toEqual([]);
    const nextInStep3 = fourSteps.replace(
      "- [ ] Later.",
      "Next: pick up here.\n\n- [ ] Later.",
    );
    expect(upcomingSteps(nextInStep3)).toEqual([
      "Step 5: Fifth",
      "Step 6: Sixth",
      "Step 7: Seventh",
    ]);
  });

  it("upcomingSteps is empty when the current step is the last open one", () => {
    expect(upcomingSteps(plan)).toEqual([]);
  });
});

describe("context on the shared plan parser, active plans and retrospectives", () => {
  it("activePlans covers every plan whose frontmatter is active, newest first, and never a done one", () => {
    const plans = {
      "1-initialize.md": `${frontmatter("done")}## Step 1: A\n\n- [ ] stale box\n`,
      "2-implementation.md": `${frontmatter("active")}## Step 9: B\n\n- [ ] open\n`,
      "3-agent-harness.md": `${frontmatter("done")}## Step 1: C\n\n- [x] done\n`,
      "4-knowledge.md": `${frontmatter("active")}## Step 1: D\n\n- [ ] open\n`,
    };
    expect(activePlans(plans)).toEqual([
      "4-knowledge.md",
      "2-implementation.md",
    ]);
  });

  it("activePlans keeps the open-item rule for plans without frontmatter", () => {
    const plans = {
      "1-old.md": "## Step 1: A\n\n- [ ] open\n",
      "2-older.md": "## Step 1: B\n\n- [ ] open\n",
      "3-closed.md": "## Step 1: C\n\n- [x] done\n",
      "4-new.md": `${frontmatter("active")}## Step 1: D\n\n- [ ] open\n`,
    };
    expect(activePlans(plans)).toEqual(["4-new.md", "2-older.md"]);
  });

  it("lastRetrospective returns the latest marker across plans, or null", () => {
    expect(
      lastRetrospective({
        "2-a.md": "Last retrospective: 2026-10-01\n",
        "3-b.md": handedOff,
      }),
    ).toBe("2026-11-01");
    expect(lastRetrospective({ "3-b.md": plan })).toBeNull();
  });

  it("lastRetrospective takes the newest marker within a plan, not the first", () => {
    expect(
      lastRetrospective({
        "3-b.md":
          "Last retrospective: 2026-11-07\n\nlater\n\n- Last retrospective: 2026-11-08\n\nearlier: Last retrospective: 2026-10-01\n",
      }),
    ).toBe("2026-11-08");
  });

  it("windowStart is local midnight of the marker day, so the marker day is inside the window", () => {
    const start = windowStart("2026-11-08");
    expect(start).toBe(new Date("2026-11-08T00:00:00").getTime());
    expect(start - 1).toBeLessThan(start);
    expect(windowStart(undefined)).toBe(0);
  });

  it("nextStep ends a Next: paragraph at a list item, which the shared parser stops at", () => {
    const markdown =
      "## Step 1: A\n\nNext: do this first\n- [ ] item\n  wrapped\n";
    expect(nextStep(markdown)).toEqual({
      step: "Step 1: A",
      text: "do this first",
    });
  });
});
