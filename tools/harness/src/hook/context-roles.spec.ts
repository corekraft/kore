// The context hook's brief for role panes: a writer, judge, reader or
// principles-review gets no plan session brief, and every other session gets
// it. The plan parser and the retrospective scan are mocked, as in context.spec.ts.
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
import { brief, restore, type JournalEntry } from "./context.js";
import { deps } from "./context-support.js";
import { lastRetrospective } from "./retro-scan.js";

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

const plans = { "4-knowledge.md": "plan" };

/** Deps whose plans are given and whose sessions-since count is fixed. */
function briefDeps(
  sessions: number,
  journals: Record<string, JournalEntry[]> = {},
) {
  return deps({
    readPlans: () => Promise.resolve(plans),
    readJournals: () => Promise.resolve(journals),
    sessionsSince: () => Promise.resolve(sessions),
  });
}

const planBrief = [
  "Session brief from infra/plans/4-knowledge.md:",
  "Open items: Step 2 (1).",
  "Next (Step 2: Open): do the next thing.",
  "Upcoming: Step 3: Third.",
].join("\n");

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue(["4-knowledge.md"]);
  vi.mocked(openCounts).mockReturnValue([{ step: "Step 2", count: 1 }]);
  vi.mocked(nextStep).mockReturnValue({
    step: "Step 2: Open",
    text: "do the next thing.",
  });
  vi.mocked(upcomingSteps).mockReturnValue(["Step 3: Third"]);
  vi.mocked(listItems).mockReturnValue([]);
  vi.mocked(openItems).mockReturnValue([]);
  vi.mocked(lastRetrospective).mockReturnValue(null);
});

describe("context brief for role panes", () => {
  it.each(["writer", "judge", "reader", "principles-review"])(
    "gives a %s pane no plan session brief",
    async (role) => {
      expect(
        await brief(
          { source: "startup", session_id: "s1", agent_type: role },
          briefDeps(0),
        ),
      ).toBe("");
    },
  );

  it.each([
    ["no agent type", {}],
    ["an empty agent type", { agent_type: "" }],
    ["an unknown agent type", { agent_type: "orchestrator" }],
    ["a non-string agent type", { agent_type: 7 }],
  ])("keeps the plan session brief for %s", async (_label, extra) => {
    expect(await brief({ source: "startup", ...extra }, briefDeps(0))).toBe(
      planBrief,
    );
  });

  it("keeps the environment lines and the retrospective reminder for a role pane", async () => {
    vi.mocked(lastRetrospective).mockReturnValue("2026-11-01");
    const journals = {
      local: [
        {
          ts: "2026-11-07T10:00:00.000Z",
          op: "a",
          kind: "start",
          command: "local up",
        },
        { ts: "2026-11-07T10:00:00.000Z", op: "a", kind: "end", outcome: "ok" },
      ],
    };
    expect(
      await brief(
        { source: "startup", agent_type: "writer" },
        briefDeps(5, journals),
      ),
    ).toBe(
      [
        "Environment local: last operation `local up` ok on 2026-11-07.",
        "5 sessions since the last retrospective (2026-11-01); run /retro.",
      ].join("\n"),
    );
  });

  it("keeps the rules and open plan items after compaction for a role pane", async () => {
    vi.mocked(listItems).mockReturnValue([
      { heading: "Code", text: "- **Rule.** Keep it." },
    ]);
    const context = await restore(
      { source: "compact", agent_type: "writer" },
      deps({ readAgents: () => Promise.resolve("# AGENTS.md") }),
    );
    expect(context).toMatch(/^Context was compacted\./);
    expect(context).toMatch(/- \*\*Rule\.\*\* Keep it\./);
  });
});
