// The context hook's one line for the main session, naming `session send` in place of
// raw `herdr agent prompt` while signed-main-sends is on (ADR 0123). It never reaches a
// role pane's brief, and a flag that cannot be read becomes a warning in its place.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlagError } from "../flag/index.js";
import { activePlans } from "../plan/index.js";
import { brief, RESULT_SUMMARY_LINE } from "./context.js";
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
  "Message a session with `harness session send <name>`, not a raw hc send: it confirms delivery and records the event; see `harness session send --help` for its flags.";
const SESSION = { source: "startup", session_id: "s1" };

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue([]);
  vi.mocked(lastRetrospective).mockReturnValue(null);
});

describe("context brief line for the main session", () => {
  it("names session send when signed-main-sends is on", async () => {
    expect(
      await brief(
        SESSION,
        deps({ signedMainSendsOn: () => Promise.resolve(true) }),
      ),
    ).toBe(LINE);
  });

  it("adds nothing when signed-main-sends is off", async () => {
    expect(
      await brief(
        SESSION,
        deps({ signedMainSendsOn: () => Promise.resolve(false) }),
      ),
    ).toBe("");
  });

  it("puts the line after the result-summary line when both flags are on", async () => {
    expect(
      await brief(
        SESSION,
        deps({
          paneResultSummaryOn: () => Promise.resolve(true),
          signedMainSendsOn: () => Promise.resolve(true),
        }),
      ),
    ).toBe([RESULT_SUMMARY_LINE, LINE].join("\n"));
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
        deps({ signedMainSendsOn: () => Promise.resolve(true) }),
      ),
    ).toBe("");
  });
});

describe("context brief when the signed-main-sends flag cannot be read", () => {
  it("warns in place of the line and keeps the rest of the brief", async () => {
    const text = await brief(
      SESSION,
      deps({
        signedMainSendsOn: () =>
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
          signedMainSendsOn: () => Promise.reject(new Error("disk gone")),
        }),
      ),
    ).rejects.toThrow("disk gone");
  });
});
