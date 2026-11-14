import { beforeEach, describe, expect, it, vi } from "vitest";
import { clipMs } from "./scope.js";
import { widen, wipOf } from "./wip.js";
import { Tally, type StageTotals } from "./tally.js";

vi.mock("./scope.js");
vi.mock("./wip.js");

const NO_WIP = { peak: 0, average: 0 };

function stage(totals: StageTotals[], name: string): StageTotals {
  const found = totals.find((s) => s.stage === name);
  if (found === undefined) {
    throw new Error(`no stage ${name}`);
  }
  return found;
}

beforeEach(() => {
  vi.mocked(wipOf).mockReturnValue(NO_WIP);
});

describe("Tally.present", () => {
  it("charges a span to the idea's open interval in the stage, clipped to the window", () => {
    const tally = new Tally([10, 20]);
    tally.beginIdea();
    tally.present("write", 5, 15);
    expect(widen).toHaveBeenCalledWith(undefined, [10, 15]);
  });

  it("keeps a point inside the window, and drops one at the window's end", () => {
    const tally = new Tally([10, 20]);
    tally.beginIdea();
    tally.present("write", 15, 15);
    tally.present("write", 20, 20);
    expect(widen).toHaveBeenCalledTimes(1);
    expect(widen).toHaveBeenCalledWith(undefined, [15, 15]);
  });

  it("drops a span that only touches the window's edge", () => {
    const tally = new Tally([10, 20]);
    tally.beginIdea();
    tally.present("write", 0, 10);
    expect(widen).not.toHaveBeenCalled();
  });

  it("widens an existing open interval in the same stage", () => {
    const tally = new Tally();
    tally.beginIdea();
    vi.mocked(widen).mockReturnValueOnce([1, 2]);
    tally.present("write", 1, 2);
    tally.present("write", 5, 6);
    expect(widen).toHaveBeenLastCalledWith([1, 2], [5, 6]);
  });
});

describe("Tally.endIdea and range", () => {
  it("returns the window when both ends are set", () => {
    expect(new Tally([3, 9]).range()).toEqual([3, 9]);
  });

  it("returns zero to zero when the window is open and no idea was in a stage", () => {
    expect(new Tally().range()).toEqual([0, 0]);
  });

  it("spans the earliest and latest open interval of every idea when an end is open", () => {
    const tally = new Tally([-Infinity, 100]);
    tally.beginIdea();
    vi.mocked(widen).mockReturnValueOnce([20, 30]);
    tally.present("write", 20, 30);
    tally.endIdea();
    tally.beginIdea();
    vi.mocked(widen).mockReturnValueOnce([5, 40]);
    tally.present("judge", 5, 40);
    tally.endIdea();
    expect(tally.range()).toEqual([5, 100]);
  });

  it("hands each stage's open intervals and the range to wipOf", () => {
    const tally = new Tally([0, 100]);
    tally.beginIdea();
    vi.mocked(widen).mockReturnValueOnce([10, 20]);
    tally.present("write", 10, 20);
    tally.endIdea();
    tally.stages();
    expect(wipOf).toHaveBeenCalledWith([[10, 20]], [0, 100]);
    expect(wipOf).toHaveBeenCalledWith([], [0, 100]);
  });
});

describe("Tally charges", () => {
  it("adds a clipped span's milliseconds to a stage's active or waiting time", () => {
    vi.mocked(clipMs).mockReturnValue(1500);
    const tally = new Tally([0, 9000]);
    tally.add("write", "activeMs", 0, 2000);
    expect(clipMs).toHaveBeenCalledWith([0, 9000], 0, 2000);
    expect(stage(tally.stages(), "write").activeSeconds).toBe(1.5);
  });

  it("adds already clipped milliseconds directly", () => {
    const tally = new Tally();
    tally.addMs("merge", "waitingMs", 2500);
    expect(stage(tally.stages(), "merge").waitingSeconds).toBe(2.5);
  });

  it("charges a span of toil, clipped to the window, under its kind", () => {
    vi.mocked(clipMs).mockReturnValue(4000);
    const tally = new Tally([0, 9000]);
    tally.addToil("judge", "retrying", 0, 5000);
    expect(stage(tally.stages(), "judge").toil.retryingSeconds).toBe(4);
  });

  it("adds already clipped toil milliseconds under their kind", () => {
    const tally = new Tally();
    tally.addToilMs("judge", "starting", 750);
    expect(stage(tally.stages(), "judge").toil.startingSeconds).toBe(0.75);
  });

  it("counts an event in its stage", () => {
    const tally = new Tally();
    tally.count("refine");
    tally.count("refine");
    expect(stage(tally.stages(), "refine").events).toBe(2);
  });
});

describe("Tally.stages", () => {
  it("lists every stage in loop order with zeroed totals for an empty tally", () => {
    const totals = new Tally().stages();
    expect(totals.map((s) => s.stage)).toEqual([
      "refine",
      "challenge",
      "await approval",
      "orchestrate",
      "write",
      "judge",
      "merge",
      "verify",
      "outcome",
    ]);
    expect(stage(totals, "write")).toEqual({
      stage: "write",
      activeSeconds: 0,
      waitingSeconds: 0,
      events: 0,
      toil: {
        startingSeconds: 0,
        stoppingSeconds: 0,
        waitingSeconds: 0,
        retryingSeconds: 0,
      },
      wip: NO_WIP,
    });
  });
});
