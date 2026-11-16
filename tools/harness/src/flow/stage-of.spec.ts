import { beforeEach, describe, expect, it, vi } from "vitest";
import { time } from "./github-waits.js";
import { ev } from "./report-support.js";
import { roleResolver, stageResolver, tokenStageResolver } from "./stage-of.js";
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

describe("tokenStageResolver places a token reading in the stage its session spent in", () => {
  it("places a stamped session's reading in its stamped stage", () => {
    vi.mocked(stageStamp).mockReturnValue("review");

    expect(
      tokenStageResolver([])(ev(5, "token.usage", { agent: "x-reader" })),
    ).toBe("review");
  });

  it("places an unstamped role's reading in the role's stage, before the PR merged too", () => {
    expect(
      tokenStageResolver([])(ev(5, "token.usage", { pane: "x-verifier" })),
    ).toBe("verify");
  });

  it("counts a session with no role in orchestrate, not nowhere (#831)", () => {
    expect(
      tokenStageResolver([])(ev(5, "token.usage", { agent: "x-reader" })),
    ).toBe("orchestrate");
  });

  it("counts the main session's reading in orchestrate", () => {
    expect(
      tokenStageResolver([])(
        ev(5, "token.usage", { session: "main-1", source: "claude" }),
      ),
    ).toBe("orchestrate");
  });
});

describe("roleResolver says whether an event's session has a role", () => {
  it("counts a session named for a role as having one", () => {
    expect(
      roleResolver([])(ev(5, "tool.start", { agent: "flow-writer" })),
    ).toBe(true);
  });

  it("counts a session stamped at launch as having one, even with no role in its name", () => {
    vi.mocked(stageStamp).mockReturnValue("write");

    expect(roleResolver([])(ev(5, "tool.start", { agent: "x-reader" }))).toBe(
      true,
    );
  });

  it("counts the pane a session runs in, when the event names no agent", () => {
    expect(roleResolver([])(ev(5, "tool.start", { pane: "w3:p4-judge" }))).toBe(
      true,
    );
  });

  it("gives the main session no role, so its events are no role's", () => {
    expect(roleResolver([])(ev(5, "tool.start", { session: "main-1" }))).toBe(
      false,
    );
  });
});
