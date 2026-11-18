import { describe, expect, it } from "vitest";
import {
  event,
  HAIKU,
  ideaLaunch,
  launch,
  SONNET,
} from "./writer-cost-support.js";
import { launchOfLinked, pricedLaunches } from "./writer-join.js";

const writerAt = (
  ms: number,
  agent: string,
  tier: string,
  effort: string | undefined,
  idea?: string,
) =>
  event(ms, "session.launch", {
    agent,
    pane: `w:${agent}`,
    role: "writer",
    tier,
    ...(effort === undefined ? {} : { effort }),
    ...(idea === undefined ? {} : { idea }),
  });

describe("priced writer launches: the effort each one ran at", () => {
  it("carries the recorded effort on each priced launch, and none on a launch from before effort was recorded", () => {
    const launches = pricedLaunches([
      writerAt(100, "h-writer", HAIKU, "high"),
      launch(200, "s-writer", "w:s", SONNET),
    ]);

    expect(launches.map((l) => [l.agent, l.effort])).toEqual([
      ["h-writer", "high"],
      ["s-writer", undefined],
    ]);
  });
});

describe("launch a merged change joins to", () => {
  it("is the linked session's own first launch when that launch carries no idea", () => {
    const launches = pricedLaunches([
      writerAt(100, "h-writer", HAIKU, "high"),
      writerAt(300, "h-writer", SONNET, "medium"),
    ]);

    expect(launchOfLinked(launches, "h-writer")).toMatchObject({
      agent: "h-writer",
      tier: HAIKU,
      effort: "high",
    });
  });

  it("is the earliest launch sharing the linked session's idea, so its effort is that launch's", () => {
    const launches = pricedLaunches([
      ideaLaunch(100, "first", "w:1", SONNET, "#7"),
      writerAt(200, "relaunch", HAIKU, "high", "#7"),
    ]);

    expect(launchOfLinked(launches, "relaunch")).toMatchObject({
      agent: "first",
      tier: SONNET,
    });
  });

  it("is undefined for a session with no priced launch, so no tier and no effort are read", () => {
    expect(launchOfLinked([], "nobody")).toBeUndefined();
  });
});
