import { beforeEach, describe, expect, it, vi } from "vitest";
import { time } from "./github-waits.js";
import { ev } from "./report-support.js";
import { stageResolver } from "./stage-of.js";
import { stageStamp, stampedStages } from "./stamped-stage.js";

vi.mock("./github-waits.js");
vi.mock("./stamped-stage.js");

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(stampedStages).mockReturnValue(new Map());
  vi.mocked(stageStamp).mockReturnValue(undefined);
});

describe("stageResolver places an event in a stage", () => {
  it("builds the stamps from the events it is given", () => {
    const events = [ev(1, "session.launch")];

    stageResolver(events);

    expect(stampedStages).toHaveBeenCalledWith(events);
  });

  it("places a stamped session's event in its stamped stage, even with no role in its name", () => {
    const stamps = new Map([["x-reader", "verify" as const]]);
    vi.mocked(stampedStages).mockReturnValue(stamps);
    vi.mocked(stageStamp).mockReturnValue("verify");
    const event = ev(5, "tool.start", { agent: "x-reader" });

    expect(stageResolver([])(event, undefined)).toBe("verify");
    expect(stageStamp).toHaveBeenCalledWith(event, stamps);
  });

  it("lets a GitHub event name its own stage over a stamp", () => {
    vi.mocked(stageStamp).mockReturnValue("write");

    expect(stageResolver([])(ev(5, "pr.merged"), undefined)).toBe("merge");
  });

  it("places an event by its pane's role when it is not stamped", () => {
    expect(
      stageResolver([])(ev(5, "tool.start", { pane: "x-writer" }), undefined),
    ).toBe("write");
  });

  it("holds a verifier's events out until the PR merged", () => {
    const event = ev(5, "tool.start", { pane: "x-verifier" });

    expect(stageResolver([])(event, undefined)).toBeUndefined();
    expect(stageResolver([])(event, 9)).toBeUndefined();
    expect(stageResolver([])(event, 5)).toBe("verify");
  });

  it("places an agentless claude event in orchestrate and an unstamped, unnamed one nowhere", () => {
    expect(stageResolver([])(ev(5, "tool.start"), undefined)).toBe(
      "orchestrate",
    );
    expect(
      stageResolver([])(ev(5, "tool.start", { agent: "x-reader" }), undefined),
    ).toBeUndefined();
  });

  it("places an approval label in await approval and any other label nowhere", () => {
    const resolve = stageResolver([]);

    expect(
      resolve(ev(5, "issue.labelled", { label: "ready-for-agent" }), undefined),
    ).toBe("await approval");
    expect(
      resolve(ev(5, "issue.labelled", { label: "spec" }), undefined),
    ).toBeUndefined();
  });
});
