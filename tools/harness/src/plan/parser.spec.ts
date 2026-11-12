import { describe, expect, it } from "vitest";
import {
  activePlans,
  nextStep,
  openCounts,
  openItems,
  planStatus,
  upcomingSteps,
} from "./parser.js";

const front = (status: string) =>
  `---\nstatus: ${status}\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n`;

const plan = [
  "# Plan",
  "",
  "## Step 1: First",
  "",
  "- [x] Done here.",
  "",
  "## Step 2: Open",
  "",
  "- [ ] **Bound output.** Cap hook output",
  "      at 40 lines.",
  "- [ ] A large report is bounded.",
  "",
].join("\n");

describe("plan parser", () => {
  it("reads the frontmatter status, and none when there is no frontmatter", () => {
    expect(planStatus(`${front("active")}## Step 1\n`)).toBe("active");
    expect(planStatus("## Step 1: A\n")).toBeUndefined();
  });

  it("lists unchecked items with their step and joins wrapped lines", () => {
    expect(openItems(plan)).toEqual([
      "Step 2: Open: - [ ] **Bound output.** Cap hook output at 40 lines.",
      "Step 2: Open: - [ ] A large report is bounded.",
    ]);
  });

  it("counts open items per step in plan order", () => {
    const text =
      "## Step 3: C\n\n- [ ] a\n- [ ] b\n\n## Step 4: D\n\n- [ ] c\n";
    expect(openCounts(text)).toEqual([
      { step: "Step 3", count: 2 },
      { step: "Step 4", count: 1 },
    ]);
    expect(openCounts("## Step 1: A\n\n- [x] done\n")).toEqual([]);
  });

  it("returns the Next: line with its step, joining wrapped lines", () => {
    const text =
      "## Step 2: Do\n\nNext: write the tests,\nthen the code.\n\n- [ ] x\n";
    expect(nextStep(text)).toEqual({
      step: "Step 2: Do",
      text: "write the tests, then the code.",
    });
    expect(nextStep(plan)).toBeNull();
  });

  it("names the next steps with open items after the current one", () => {
    const text = [
      "## Step 1: A\n\n- [ ] a\n",
      "## Step 2: B\n\nNext: here.\n\n- [ ] b\n",
      "## Step 3: C\n\n- [x] c\n",
      "## Step 4: D\n\n- [ ] d\n",
      "## Step 5: E\n\n- [ ] e\n",
      "## Step 6: F\n\n- [ ] f\n",
      "## Step 7: G\n\n- [ ] g\n",
    ].join("\n");
    expect(upcomingSteps(text)).toEqual([
      "Step 4: D",
      "Step 5: E",
      "Step 6: F",
    ]);
    expect(upcomingSteps("## Step 1: A\n\n- [ ] a\n")).toEqual([]);
  });

  it("selects frontmatter-active plans newest first and never a done one", () => {
    expect(
      activePlans({
        "1-a.md": `${front("done")}## Step 1: A\n\n- [ ] stale\n`,
        "2-b.md": `${front("active")}## Step 9: B\n\n- [ ] open\n`,
        "10-c.md": `${front("active")}## Step 1: C\n\n- [x] done\n`,
        "4-d.md": `${front("active")}## Step 1: D\n\n- [ ] open\n`,
      }),
    ).toEqual(["10-c.md", "4-d.md", "2-b.md"]);
  });

  it("keeps the open-item rule for plans without frontmatter", () => {
    expect(
      activePlans({
        "1-old.md": "## Step 1: A\n\n- [ ] open\n",
        "2-older.md": "## Step 1: B\n\n- [ ] open\n",
        "3-closed.md": "## Step 1: C\n\n- [x] done\n",
        "4-new.md": `${front("active")}## Step 1: D\n\n- [ ] open\n`,
      }),
    ).toEqual(["4-new.md", "2-older.md"]);
    expect(activePlans({ "1-a.md": "- [x] done\n" })).toEqual([]);
  });
});

describe("plan parser Next: paragraphs", () => {
  it("ends the Next: line at a list item and ignores Next: inside a code fence", () => {
    expect(
      nextStep("## Step 1: A\n\nNext: go\n- [ ] one\n- [ ] two\n")?.text,
    ).toBe("go");
    expect(
      nextStep("## Step 1: A\n\n```\nNext: fenced\n```\n\n- [ ] one\n"),
    ).toBeNull();
    expect(nextStep("## Step 1: A\n\nNext: go\n```\nmore\n```\n")?.text).toBe(
      "go",
    );
  });
});
