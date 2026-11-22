import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  FinishDetection,
  LeadTime,
  StalledPanes,
} from "./idea-metrics.js";
import { inWindow, scopeOf, windowOf } from "./scope.js";
import { sourceFigures, type SourceFigures } from "./source-figures.js";
import { time } from "./github-waits.js";
import { newLife } from "./toil.js";
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

const FINISH: FinishDetection = {
  windowSeconds: 300,
  results: 0,
  detected: 0,
  undetected: 0,
  neverNoticed: 0,
  late: 0,
  medianLagSeconds: null,
  lagMinutes: { samples: 0, median: null, p90: null },
};
const STALLS: StalledPanes = {
  silenceSeconds: 900,
  recorded: 0,
  silentSessions: 0,
  backgroundExcluded: 0,
  questionExcluded: 0,
};
const NO_LEAD: LeadTime = { ideas: [], medianSeconds: null, maxSeconds: null };
const LEAD: LeadTime = {
  ideas: [{ idea: "#9", seconds: 5 }],
  medianSeconds: 5,
  maxSeconds: 5,
};

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
    const terminal: NonNullable<SourceFigures["terminal"]> = {
      finishDetection: FINISH,
      stalledPanes: STALLS,
      leadTime: NO_LEAD,
      mainSession: {
        paneReadsPerFinishedPane: {
          status: "insufficient",
          reason: "the retro scan counts herdr pane reads only",
        },
        signedSendShare: {
          status: "insufficient",
          reason: "the retro scan counts no raw terminal sends",
        },
      },
    };
    const figures: SourceFigures = {
      finishDetection: FINISH,
      stalledPanes: STALLS,
      leadTime: LEAD,
      terminal,
    };
    vi.mocked(sourceFigures).mockReturnValue(figures);
    const r = run([herdrFinish, terminalFinish]);
    expect(r.finishDetection).toBe(FINISH);
    expect(r.stalledPanes).toBe(STALLS);
    expect(r.terminal).toBe(terminal);
  });

  it("takes the report's lead time from the source figures, which the report sets over ideaMetrics' copy", () => {
    fakeTally();
    vi.mocked(sourceFigures).mockReturnValue({
      finishDetection: FINISH,
      stalledPanes: STALLS,
      leadTime: LEAD,
      terminal: null,
    });
    expect(run([herdrFinish]).leadTime).toBe(LEAD);
  });
});
