import { beforeEach, describe, expect, it, vi } from "vitest";
import { ideaMetrics } from "./idea-metrics.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { sourceFigures } from "./source-figures.js";
import { newLife } from "./toil.js";
import { time } from "./github-waits.js";
import {
  ASOF,
  SCOPE,
  WINDOW,
  cover,
  ev,
  fakeLife,
  fakeTally,
  run,
} from "./report-support.js";

vi.mock("./github-waits.js");
vi.mock("./idea-metrics.js");
vi.mock("./select.js");
vi.mock("./scope.js");
vi.mock("./source-figures.js");
vi.mock("./tally.js");
vi.mock("./toil.js");

beforeEach(() => {
  vi.mocked(scopeOf).mockReturnValue(SCOPE);
  vi.mocked(windowOf).mockReturnValue(WINDOW);
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockReturnValue(true);
  vi.mocked(newLife).mockReturnValue(fakeLife());
  cover(new Map());
});

describe("buildReport reads its pane figures from the source figures (#1782)", () => {
  const herdrFinish = ev(1, "pane.finished", {
    source: "herdr",
    pane: "w1",
    session: "h",
  });
  const terminalFinish = ev(2, "pane.finished", {
    source: "terminal",
    pane: "t1",
    session: "t",
  });

  it("passes the events, the named events and the ideas to the source figures, at the report's as-of time", () => {
    fakeTally();
    const events = [herdrFinish, terminalFinish];
    const own = [herdrFinish];
    cover(new Map([["#1", own]]), events);
    run(events);
    expect(sourceFigures).toHaveBeenCalledWith(
      events,
      events,
      new Map([["#1", own]]),
      WINDOW,
      ASOF.getTime(),
    );
  });

  it("puts the source figures' pane readings on the report, the terminal reading under terminal", () => {
    fakeTally();
    const figures = {
      finishDetection: { results: 1 },
      stalledPanes: { recorded: 2 },
      leadTime: { ideas: [] },
      terminal: { finishDetection: { results: 3 } },
    };
    vi.mocked(sourceFigures).mockReturnValue(figures as never);
    const r = run([herdrFinish, terminalFinish]);
    expect(r.finishDetection).toBe(figures.finishDetection);
    expect(r.stalledPanes).toBe(figures.stalledPanes);
    expect(r.leadTime).toBe(figures.leadTime);
    expect(r.terminal).toBe(figures.terminal);
  });

  it("keeps ideaMetrics for the cost metrics alone, so the lead time is the source figures'", () => {
    fakeTally();
    vi.mocked(sourceFigures).mockReturnValue({
      leadTime: { ideas: [] },
    } as never);
    run([]);
    expect(ideaMetrics).toHaveBeenCalled();
  });
});
