import { beforeEach, describe, expect, it, vi } from "vitest";
import { activePlans, nextStep, openCounts, upcomingSteps } from "./parser.js";
import { planActive, readActivePlans } from "./active.js";
import { readPlans } from "./store.js";
import { fakeDeps } from "./plan-support.js";

// The parser and the store are typed automocks; each test sets the answers it needs.
vi.mock("./parser.js");
vi.mock("./store.js");

const PLANS: Record<string, string> = {
  "9-b.md": "plan B",
  "2-a.md": "plan A",
};

beforeEach(() => {
  vi.mocked(readPlans).mockResolvedValue(PLANS);
  vi.mocked(activePlans).mockReturnValue(["9-b.md", "2-a.md"]);
  vi.mocked(openCounts).mockImplementation((md) =>
    md === "plan A"
      ? [
          { step: "Step 1", count: 2 },
          { step: "Step 2", count: 1 },
        ]
      : [{ step: "Step 1", count: 1 }],
  );
  vi.mocked(nextStep).mockImplementation((md) =>
    md === "plan A" ? { step: "Step 2: B", text: "go." } : null,
  );
  vi.mocked(upcomingSteps).mockReturnValue([]);
});

describe("readActivePlans", () => {
  it("returns each active plan, highest-numbered first, with its open items", async () => {
    expect(await readActivePlans(fakeDeps())).toEqual([
      {
        file: "infra/plans/9-b.md",
        name: "9-b.md",
        default: true,
        open: [{ step: "Step 1", count: 1 }],
        next: null,
        upcoming: [],
      },
      {
        file: "infra/plans/2-a.md",
        name: "2-a.md",
        default: false,
        open: [
          { step: "Step 1", count: 2 },
          { step: "Step 2", count: 1 },
        ],
        next: { step: "Step 2: B", text: "go." },
        upcoming: [],
      },
    ]);
  });

  it("parses each plan's own text, not another plan's", async () => {
    await readActivePlans(fakeDeps());
    expect(vi.mocked(openCounts).mock.calls).toEqual([["plan B"], ["plan A"]]);
    expect(vi.mocked(nextStep).mock.calls).toEqual([["plan B"], ["plan A"]]);
    expect(vi.mocked(upcomingSteps).mock.calls).toEqual([
      ["plan B"],
      ["plan A"],
    ]);
  });

  it("reads a named plan with no text as empty, rather than failing", async () => {
    vi.mocked(activePlans).mockReturnValue(["3-c.md"]);
    vi.mocked(readPlans).mockResolvedValue({});
    const [plan] = await readActivePlans(fakeDeps());
    expect(openCounts).toHaveBeenCalledWith("");
    expect(plan).toMatchObject({ name: "3-c.md", default: true });
  });

  it("passes the upcoming steps through from the parser", async () => {
    vi.mocked(upcomingSteps).mockReturnValue(["Step 3: C", "Step 4: D"]);
    const [first] = await readActivePlans(fakeDeps());
    expect(first?.upcoming).toEqual(["Step 3: C", "Step 4: D"]);
  });
});

describe("planActive as JSON", () => {
  it("prints the default plan's name and every listed plan as one JSON line", async () => {
    const deps = fakeDeps();
    expect(await planActive.run({ json: true, deps, options: {} })).toBe(0);
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [
        `${JSON.stringify({
          default: "9-b.md",
          plans: [
            {
              file: "infra/plans/9-b.md",
              name: "9-b.md",
              default: true,
              open: [{ step: "Step 1", count: 1 }],
              next: null,
              upcoming: [],
            },
            {
              file: "infra/plans/2-a.md",
              name: "2-a.md",
              default: false,
              open: [
                { step: "Step 1", count: 2 },
                { step: "Step 2", count: 1 },
              ],
              next: { step: "Step 2: B", text: "go." },
              upcoming: [],
            },
          ],
        })}\n`,
      ],
    ]);
  });

  it("reports a null default and an empty list when no plan is active", async () => {
    vi.mocked(activePlans).mockReturnValue([]);
    const deps = fakeDeps();
    expect(await planActive.run({ json: true, deps, options: {} })).toBe(0);
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      ['{"default":null,"plans":[]}\n'],
    ]);
  });
});

describe("planActive as text", () => {
  it("flags the default plan and lists its open items, next line and upcoming steps", async () => {
    vi.mocked(upcomingSteps).mockReturnValue(["Step 3: C"]);
    const deps = fakeDeps();
    await planActive.run({ json: false, deps, options: {} });
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [
        [
          "infra/plans/9-b.md (default)",
          "  Open items: Step 1 (1)",
          "  Upcoming: Step 3: C",
          "infra/plans/2-a.md",
          "  Open items: Step 1 (2), Step 2 (1)",
          "  Next (Step 2: B): go.",
          "  Upcoming: Step 3: C",
          "",
        ].join("\n"),
      ],
    ]);
  });

  it("says no open items when a plan has none, and prints nothing else for it", async () => {
    vi.mocked(openCounts).mockReturnValue([]);
    vi.mocked(activePlans).mockReturnValue(["9-b.md"]);
    const deps = fakeDeps();
    await planActive.run({ json: false, deps, options: {} });
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      ["infra/plans/9-b.md (default)\n  Open items: none\n"],
    ]);
  });

  it("says plainly that no plan is active, with exit 0", async () => {
    vi.mocked(activePlans).mockReturnValue([]);
    const deps = fakeDeps();
    expect(await planActive.run({ json: false, deps, options: {} })).toBe(0);
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [
        'No active plan: no file in infra/plans has "status: active" in its frontmatter.\n',
      ],
    ]);
  });
});
