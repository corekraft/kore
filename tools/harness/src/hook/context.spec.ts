// The context hook's brief, compaction restore and environment lines, with the
// plan parser and the retrospective scan mocked. The plan-text cases run for
// real in integration/hook.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activePlans,
  listItems,
  nextStep,
  openCounts,
  openItems,
  upcomingSteps,
} from "../plan/index.js";
import { brief, restore, rules, type JournalEntry } from "./context.js";
import { deps } from "./context-support.js";
import { lastRetrospective, MarkerError } from "./retro-scan.js";

// The plan parser is another domain's unit, and the retrospective scan reads
// plan markers; both are automocked. The error class and the plans directory
// are real.
vi.mock("../plan/index.js", () => ({
  activePlans: vi.fn(),
  listItems: vi.fn(),
  nextStep: vi.fn(),
  openCounts: vi.fn(),
  openItems: vi.fn(),
  upcomingSteps: vi.fn(),
}));
vi.mock("./retro-scan.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./retro-scan.js")>();
  return {
    MarkerError: real.MarkerError,
    PLANS_DIR: real.PLANS_DIR,
    lastRetrospective: vi.fn(),
    windowStart: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue([]);
  vi.mocked(openCounts).mockReturnValue([]);
  vi.mocked(nextStep).mockReturnValue(null);
  vi.mocked(upcomingSteps).mockReturnValue([]);
  vi.mocked(openItems).mockReturnValue([]);
  vi.mocked(listItems).mockReturnValue([]);
  vi.mocked(lastRetrospective).mockReturnValue(null);
});

const entry = (op: string, kind: string, extra = {}): JournalEntry => ({
  ts: "2026-11-07T10:00:00.000Z",
  op,
  kind,
  ...extra,
});
const withJournals = (journals: Record<string, JournalEntry[]>) =>
  deps({ readJournals: () => Promise.resolve(journals) });

/** Deps whose plans are given and whose sessions-since count is fixed; its calls are a mock the spec reads. */
function briefDeps(sessions: number, plans: Record<string, string> = {}) {
  const sessionsSince = vi.fn((_date: string | null, _current?: string) =>
    Promise.resolve(sessions),
  );
  return {
    ...deps({ readPlans: () => Promise.resolve(plans), sessionsSince }),
    sessionsSince,
  };
}

describe("context rules", () => {
  it("keeps each AGENTS.md list item's text, enforcement markers included", () => {
    vi.mocked(listItems).mockReturnValue([
      { heading: "Code", text: "- **Errors.** Fix them. _Enforced: `x`._" },
      { heading: "Platform", text: "- **Owner.** One owner." },
    ]);
    expect(rules("# AGENTS.md")).toEqual([
      "- **Errors.** Fix them. _Enforced: `x`._",
      "- **Owner.** One owner.",
    ]);
    expect(vi.mocked(listItems).mock.calls).toEqual([["# AGENTS.md"]]);
  });
});

describe("context restore", () => {
  it("says nothing on resume, and reads nothing", async () => {
    const readPlans = vi.fn(() => Promise.resolve({}));
    expect(await restore({ source: "resume" }, deps({ readPlans }))).toBe("");
    expect(readPlans).not.toHaveBeenCalled();
  });

  it("states the rules and the active plan's open items after compaction", async () => {
    vi.mocked(listItems).mockReturnValue([
      { heading: "Code", text: "- **Rule.** Keep it." },
    ]);
    vi.mocked(activePlans).mockReturnValue(["3-agent-harness.md"]);
    vi.mocked(openItems).mockReturnValue(["Step 2: Open: - [ ] Bound output."]);
    const d = deps({
      readAgents: () => Promise.resolve("# AGENTS.md"),
      readPlans: () => Promise.resolve({ "3-agent-harness.md": "plan" }),
    });
    expect(await restore({ source: "compact" }, d)).toBe(
      [
        "Context was compacted. Keep applying these AGENTS.md rules; hooks check only the parts marked Enforced or Audited:",
        "- **Rule.** Keep it.",
        "",
        "Open plan items in infra/plans/3-agent-harness.md:",
        "Step 2: Open: - [ ] Bound output.",
      ].join("\n"),
    );
    expect(vi.mocked(openItems).mock.calls).toEqual([["plan"]]);
  });

  it("states only the rules after compaction when no plan is active", async () => {
    const context = await restore({ source: "compact" }, deps());
    expect(context).toMatch(/^Context was compacted\./);
    expect(context).not.toMatch(/Open plan items/);
  });

  it("brief on a fresh start never restates the rules, which a new session already loads", async () => {
    const context = await restore({ source: "startup" }, briefDeps(0));
    expect(context).toBe("");
    expect(vi.mocked(listItems)).not.toHaveBeenCalled();
  });

  it("is empty for a fresh start or clear with no plan and no retrospective due", async () => {
    expect(await restore({ source: "startup" }, deps())).toBe("");
    expect(await restore({ source: "clear" }, deps())).toBe("");
  });
});

describe("context brief", () => {
  it("names the active plan, its open items, and its Next: line", async () => {
    vi.mocked(activePlans).mockReturnValue(["3-agent-harness.md"]);
    vi.mocked(openCounts).mockReturnValue([
      { step: "Step 8", count: 1 },
      { step: "Step 9", count: 1 },
    ]);
    vi.mocked(nextStep).mockReturnValue({
      step: "Step 9: Operator Load",
      text: "write the statusline tests.",
    });
    const context = await brief(
      { source: "startup", session_id: "s1" },
      briefDeps(0, { "3-agent-harness.md": "plan" }),
    );
    expect(context).toBe(
      [
        "Session brief from infra/plans/3-agent-harness.md:",
        "Open items: Step 8 (1), Step 9 (1).",
        "Next (Step 9: Operator Load): write the statusline tests.",
      ].join("\n"),
    );
    expect(vi.mocked(openCounts).mock.calls).toEqual([["plan"]]);
  });

  it("omits the open-items and upcoming lines when there are none", async () => {
    vi.mocked(activePlans).mockReturnValue(["4-knowledge.md"]);
    const context = await brief(
      { source: "startup" },
      briefDeps(0, { "4-knowledge.md": "plan" }),
    );
    expect(context).toBe("Session brief from infra/plans/4-knowledge.md:");
  });

  it("lists upcoming step titles joined by semicolons", async () => {
    vi.mocked(activePlans).mockReturnValue(["4-knowledge.md"]);
    vi.mocked(upcomingSteps).mockReturnValue([
      "Step 3: Third",
      "Step 5: Fifth",
    ]);
    const context = await brief(
      { source: "startup" },
      briefDeps(0, { "4-knowledge.md": "plan" }),
    );
    expect(context).toMatch(/^Upcoming: Step 3: Third; Step 5: Fifth\.$/m);
  });

  it("covers every active plan, in the order the parser gives", async () => {
    vi.mocked(activePlans).mockReturnValue([
      "4-knowledge.md",
      "2-implementation.md",
    ]);
    const context = await brief(
      { source: "startup" },
      briefDeps(0, { "4-knowledge.md": "a", "2-implementation.md": "b" }),
    );
    expect(context.split("\n")).toEqual([
      "Session brief from infra/plans/4-knowledge.md:",
      "Session brief from infra/plans/2-implementation.md:",
    ]);
  });
});

describe("context brief, retrospective reminder", () => {
  it("reminds about a retrospective once five sessions have passed since the marker", async () => {
    vi.mocked(lastRetrospective).mockReturnValue("2026-11-01");
    const due = briefDeps(5);
    expect(await brief({ source: "clear", session_id: "s1" }, due)).toBe(
      "5 sessions since the last retrospective (2026-11-01); run /retro.",
    );
    expect(due.sessionsSince.mock.calls).toEqual([["2026-11-01", "s1"]]);
  });

  it("stays silent with four sessions since the marker", async () => {
    vi.mocked(lastRetrospective).mockReturnValue("2026-11-01");
    expect(await brief({ source: "clear" }, briefDeps(4))).toBe("");
  });

  it("counts every session as since the last retrospective when there is no marker", async () => {
    expect(await brief({ source: "startup" }, briefDeps(5))).toBe(
      "5 sessions without a recorded retrospective; run /retro.",
    );
  });

  it("shows a malformed marker as a warning in place of the reminder, and counts nothing", async () => {
    vi.mocked(lastRetrospective).mockImplementation(() => {
      throw new MarkerError("bad marker");
    });
    const d = briefDeps(5);
    expect(await brief({ source: "startup" }, d)).toBe("Warning: bad marker");
    expect(d.sessionsSince.mock.calls).toEqual([]);
  });
});

describe("context environment lines", () => {
  it("says nothing about an environment with no journal entries", async () => {
    expect(
      await restore({ source: "startup" }, withJournals({ local: [] })),
    ).toBe("");
  });

  it("reports a finished operation with its outcome and date", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local up" }),
        entry("a", "exec", { command: "helm" }),
        entry("a", "end", { outcome: "ok", ms: 5 }),
      ],
    };
    expect(await restore({ source: "startup" }, withJournals(journals))).toBe(
      "Environment local: last operation `local up` ok on 2026-11-07.",
    );
  });

  it("reports a failed operation with its error", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local up" }),
        entry("a", "end", { outcome: "failed", error: "helm timed out" }),
      ],
    };
    expect(await restore({ source: "startup" }, withJournals(journals))).toBe(
      "Environment local: last operation `local up` failed on 2026-11-07: helm timed out.",
    );
  });

  it("flags an interrupted operation and judges only the latest one", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local down" }),
        entry("a", "end", { outcome: "failed", error: "old" }),
        entry("b", "start", { command: "local up" }),
        entry("b", "exec", { command: "helm" }),
      ],
    };
    expect(await restore({ source: "startup" }, withJournals(journals))).toBe(
      "Environment local: last operation `local up` was interrupted (started 2026-11-07, no end recorded).",
    );
  });

  it("lists environments in name order, one line each", async () => {
    const done = [
      entry("a", "start", { command: "x" }),
      entry("a", "end", { outcome: "ok" }),
    ];
    const lines = (
      await restore(
        { source: "startup" },
        withJournals({ staging: done, local: done }),
      )
    ).split("\n");
    expect(lines.map((line) => line.split(":")[0])).toEqual([
      "Environment local",
      "Environment staging",
    ]);
  });
});
