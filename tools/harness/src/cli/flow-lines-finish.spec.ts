import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { finishLines } from "./flow-lines-finish.js";

type Figures = Pick<FlowReport, "finishDetection" | "stalledPanes">;

const noFinish = {
  windowSeconds: 300,
  results: 0,
  detected: 0,
  undetected: 0,
  neverNoticed: 0,
  late: 0,
  medianLagSeconds: null,
  lagMinutes: { samples: 0, median: null, p90: null },
};

const noStall = {
  silenceSeconds: 900,
  recorded: 0,
  silentSessions: 0,
  backgroundExcluded: 0,
  questionExcluded: 0,
};

describe("flow report text: finish detection and silent sessions (#1090)", () => {
  it("prints the noticed, never noticed and late split, the minutes lag and the silent sessions beside the recorded stalls", () => {
    const figures: Figures = {
      finishDetection: {
        ...noFinish,
        results: 3,
        detected: 1,
        undetected: 2,
        neverNoticed: 1,
        late: 1,
        medianLagSeconds: 30,
        lagMinutes: { samples: 2, median: 10.25, p90: 20 },
      },
      stalledPanes: { ...noStall, recorded: 1 },
    };
    expect(finishLines(figures)).toEqual([
      "Finish detection: 1 of 3 results noticed (a pane.finished recorded by session wait on the result's pane within the 300s placeholder window); never noticed 1, late 1",
      "Finish lag in minutes, detected and late: median 10.25, p90 20, over 2 finishes. Not a merge delay.",
      "Silent sessions: 0 (last token usage more than 900s earlier and no RESULT since; background-command excluded 0, open-question excluded 0); recorded pane.stalled: 1",
    ]);
  });

  it("says no result and no lag were read when the range holds none, instead of a median of zero", () => {
    expect(
      finishLines({ finishDetection: noFinish, stalledPanes: noStall }),
    ).toEqual([
      "Finish detection: no results with a pane in this range",
      "Finish lag in minutes, detected and late: no finish with a lag",
      "Silent sessions: 0 (last token usage more than 900s earlier and no RESULT since; background-command excluded 0, open-question excluded 0); recorded pane.stalled: 0",
    ]);
  });
});
