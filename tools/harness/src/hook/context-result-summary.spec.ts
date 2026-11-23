// The context hook's one line for the main session, naming `harness session wait`
// as the place a finished pane's result summary is read (ADR 0123). It shows only
// while pane-result-summary is on, never in a role pane's brief, and a flag that
// cannot be read becomes a warning in its place.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlagError } from "../flag/index.js";
import {
  activePlans,
  listItems,
  nextStep,
  openCounts,
  openItems,
  upcomingSteps,
} from "../plan/index.js";
import { brief } from "./context.js";
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

const LINE =
  "A finished session's result summary is read with `harness session wait <name>`, not a read of its terminal; see `harness session wait --help` for how to print it.";
const SESSION = { source: "startup", session_id: "s1" };

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue([]);
  vi.mocked(lastRetrospective).mockReturnValue(null);
});

describe("context brief line for the main session", () => {
  it("names harness session wait and its help when pane-result-summary is on", async () => {
    expect(
      await brief(
        SESSION,
        deps({ paneResultSummaryOn: () => Promise.resolve(true) }),
      ),
    ).toBe(LINE);
  });

  it("adds nothing when pane-result-summary is off", async () => {
    expect(
      await brief(
        SESSION,
        deps({ paneResultSummaryOn: () => Promise.resolve(false) }),
      ),
    ).toBe("");
  });

  it("puts the line after the plan session brief", async () => {
    vi.mocked(activePlans).mockReturnValue(["4-knowledge.md"]);
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 2", count: 1 }]);
    vi.mocked(nextStep).mockReturnValue({
      step: "Step 2: Open",
      text: "do the next thing.",
    });
    vi.mocked(upcomingSteps).mockReturnValue([]);
    vi.mocked(listItems).mockReturnValue([]);
    vi.mocked(openItems).mockReturnValue([]);

    const text = await brief(
      SESSION,
      deps({
        readPlans: () => Promise.resolve({ "4-knowledge.md": "plan" }),
        paneResultSummaryOn: () => Promise.resolve(true),
      }),
    );

    expect(text).toBe(
      [
        "Session brief from infra/plans/4-knowledge.md:",
        "Open items: Step 2 (1).",
        "Next (Step 2: Open): do the next thing.",
        LINE,
      ].join("\n"),
    );
  });
});

describe("context brief line for role panes", () => {
  it.each([
    "writer",
    "judge",
    "reader",
    "principles-review",
    "orchestrator",
    "advisor",
  ])("never gives a %s pane the line, even with the flag on", async (role) => {
    expect(
      await brief(
        { source: "startup", agent_type: role },
        deps({ paneResultSummaryOn: () => Promise.resolve(true) }),
      ),
    ).toBe("");
  });
});

describe("context brief when the flag cannot be read", () => {
  it("warns in place of the line and keeps the rest of the brief", async () => {
    const text = await brief(
      SESSION,
      deps({
        paneResultSummaryOn: () =>
          Promise.reject(new FlagError("The local overlay is malformed.")),
      }),
    );

    expect(text).toBe("Warning: The local overlay is malformed.");
  });

  it("rethrows a fault that is not a flag error", async () => {
    await expect(
      brief(
        SESSION,
        deps({
          paneResultSummaryOn: () => Promise.reject(new Error("disk gone")),
        }),
      ),
    ).rejects.toThrow("disk gone");
  });
});
