import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  firstTime,
  githubSpans,
  githubWaits,
  time,
  type GithubWait,
} from "./github-waits.js";
import { uncovered, type Span } from "./intervals.js";
import { Tally } from "./tally.js";

const T0 = Date.parse("2026-01-02T00:00:00.000Z");

let seq = 0;

/** A ledger event `seconds` after T0; the source is claude unless the fields name one. */
function at(
  seconds: number,
  kind: Kind,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq += 1;
  const occurredAt = new Date(T0 + seconds * 1000).toISOString();
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt,
    recordedAt: occurredAt,
    ...fields,
  };
}

vi.mock("./intervals.js");
vi.mock("./tally.js");

/**
 * The tally is automocked, so its constructor and methods are mocks. The
 * constructor is mocked too, so the window it would have set is set here.
 */
function fakeTally(window: Span) {
  const tally = Object.assign(new Tally(window), { window });
  const present = vi.fn<Tally["present"]>();
  const addMs = vi.fn<Tally["addMs"]>();
  tally.present = present;
  tally.addMs = addMs;
  return { tally, present, addMs };
}

describe("time", () => {
  it("reads an event's occurrence in milliseconds", () => {
    expect(time(at(2, "issue.opened"))).toBe(
      Date.parse("2026-01-02T00:00:02Z"),
    );
  });
});

describe("firstTime", () => {
  it("is the earliest time among the events that match", () => {
    const events = [
      at(30, "issue.labelled"),
      at(10, "issue.labelled"),
      at(5, "issue.opened"),
    ];
    const match = (e: LedgerEvent) => e.kind === "issue.labelled";
    expect(firstTime(events, match)).toBe(time(events[1] as LedgerEvent));
  });

  it("is undefined when no event matches", () => {
    expect(firstTime([at(1, "issue.opened")], () => false)).toBeUndefined();
  });
});

describe("githubSpans", () => {
  it("ends the approval wait at the approval label, and the merge wait at the merge", () => {
    const events = [
      at(0, "issue.opened"),
      at(40, "issue.labelled", { label: "ready-for-agent" }),
      at(50, "pr.opened"),
      at(90, "pr.merged"),
    ];
    expect(githubSpans(events, 1000)).toEqual([
      [
        "await approval",
        time(events[0] as LedgerEvent),
        time(events[1] as LedgerEvent),
      ],
      ["merge", time(events[2] as LedgerEvent), time(events[3] as LedgerEvent)],
    ]);
  });

  it("ignores a label that is not the approval label", () => {
    const opened = at(0, "issue.opened");
    const asOf = time(at(100, "outcome"));
    const events = [opened, at(40, "issue.labelled", { label: "wontfix" })];
    expect(githubSpans(events, asOf)).toEqual([
      ["await approval", time(opened), asOf],
    ]);
  });

  it("stops an open wait at the issue's close when nothing ends it first", () => {
    const opened = at(0, "issue.opened");
    const closed = at(60, "issue.closed");
    expect(githubSpans([opened, closed], time(at(1000, "outcome")))).toEqual([
      ["await approval", time(opened), time(closed)],
    ]);
  });

  it("stops an open wait at asOf when the issue is still open", () => {
    const opened = at(0, "pr.opened");
    const asOf = time(at(500, "outcome"));
    expect(githubSpans([opened], asOf)).toEqual([
      ["merge", time(opened), asOf],
    ]);
  });

  it("omits a wait that never started", () => {
    expect(githubSpans([at(0, "pr.merged")], 500)).toEqual([]);
  });

  it("omits a wait that ends at or before it starts", () => {
    const events = [at(50, "pr.opened"), at(20, "pr.merged")];
    expect(githubSpans(events, 500)).toEqual([]);
  });
});

describe("githubWaits", () => {
  const wait: GithubWait = ["merge", 100, 300];

  beforeEach(() => {
    vi.mocked(uncovered).mockReturnValue(0);
  });

  it("marks every wait present, even one wholly outside the window", () => {
    const { tally, present, addMs } = fakeTally([1000, 2000]);
    githubWaits(tally, [wait], []);
    expect(present.mock.calls).toEqual([["merge", 100, 300]]);
    expect(addMs.mock.calls).toEqual([]);
  });

  it("charges the wait's time inside the window, minus the holes, as waiting", () => {
    const { tally, addMs } = fakeTally([200, 1000]);
    vi.mocked(uncovered).mockReturnValue(42);
    githubWaits(tally, [wait], [[250, 260]]);
    expect(vi.mocked(uncovered).mock.calls).toEqual([
      [[200, 300], [[250, 260]]],
    ]);
    expect(addMs.mock.calls).toEqual([["merge", "waitingMs", 42]]);
  });

  it("clips the charged span to the window on both ends", () => {
    const { tally } = fakeTally([150, 250]);
    githubWaits(tally, [wait], []);
    expect(vi.mocked(uncovered).mock.calls).toEqual([[[150, 250], []]]);
  });

  it("charges nothing for a wait that ends before the window opens", () => {
    const { tally, addMs } = fakeTally([400, 500]);
    githubWaits(tally, [wait], []);
    expect(uncovered).not.toHaveBeenCalled();
    expect(addMs.mock.calls).toEqual([]);
  });
});
