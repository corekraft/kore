import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { armGuards } from "./writer-arm-guards.js";
import { sendBacksInRange } from "./send-back-categories.js";
import { ownerMinutesIn } from "./writer-tier-figures.js";
import { latestResults } from "./writer-usage.js";

// The guards are the unit under test: the figures they read come from the three helpers below,
// each mocked here so the arithmetic is tested alone.
vi.mock("./send-back-categories.js", () => ({ sendBacksInRange: vi.fn() }));
vi.mock("./writer-tier-figures.js", () => ({ ownerMinutesIn: vi.fn() }));
vi.mock("./writer-usage.js", () => ({ latestResults: vi.fn() }));

const SPAN: [number, number] = [0, 100];
const EVENTS: LedgerEvent[] = [];

const outcome = (result: "done" | "blocked") => ({ at: 1, result });

describe("armGuards: the blocked share of the arm's writer sessions", () => {
  beforeEach(() => {
    vi.mocked(sendBacksInRange).mockReturnValue(0);
    vi.mocked(ownerMinutesIn).mockReturnValue(0);
  });

  it("is the blocked sessions over the arm's writer sessions with a result in the span", () => {
    vi.mocked(latestResults).mockReturnValue(
      new Map([
        ["h-writer", outcome("blocked")],
        ["s-writer", outcome("done")],
      ]),
    );

    const guards = armGuards(
      EVENTS,
      SPAN,
      [100, 101],
      ["h-writer", "s-writer", "t-writer"],
    );

    expect(latestResults).toHaveBeenCalledWith(EVENTS, SPAN[1]);
    expect(guards.blockedShare).toBe(0.5);
  });

  it("leaves a writer with no result out of the share, never as a done one", () => {
    vi.mocked(latestResults).mockReturnValue(
      new Map([["h-writer", outcome("done")]]),
    );

    const guards = armGuards(EVENTS, SPAN, [100], ["h-writer", "t-writer"]);

    expect(guards.blockedShare).toBe(0);
  });

  it("reads no share, never a zero, when no writer session has a result", () => {
    vi.mocked(latestResults).mockReturnValue(new Map());

    const guards = armGuards(EVENTS, SPAN, [100], ["h-writer"]);

    expect(guards.blockedShare).toBeNull();
  });
});

describe("armGuards: send-backs and owner minutes per merged change", () => {
  beforeEach(() => {
    vi.mocked(latestResults).mockReturnValue(new Map());
  });

  it("counts only the send-backs that name one of the arm's changes, over those changes", () => {
    const sendBack = (number: number): LedgerEvent =>
      ({ kind: "send-back", number }) as LedgerEvent;
    const send = { kind: "session.send", number: 100 } as LedgerEvent;
    const events = [sendBack(100), sendBack(999), send];
    vi.mocked(sendBacksInRange).mockReturnValue(3);

    const guards = armGuards(events, SPAN, [100, 101], []);

    expect(sendBacksInRange).toHaveBeenCalledWith([sendBack(100)], SPAN);
    expect(guards.sendBacksPerMergedChange).toBe(1.5);
  });

  it("reads the owner minutes on the arm's changes over those changes", () => {
    vi.mocked(ownerMinutesIn).mockReturnValue(6);

    const guards = armGuards(EVENTS, SPAN, [100, 101, 102, 103], []);

    expect(ownerMinutesIn).toHaveBeenCalledWith(
      EVENTS,
      SPAN,
      [100, 101, 102, 103],
    );
    expect(guards.ownerMinutesPerMergedChange).toBe(1.5);
  });

  it("rounds a per-change figure to four places", () => {
    vi.mocked(sendBacksInRange).mockReturnValue(1);

    const guards = armGuards(EVENTS, SPAN, [100, 101, 102], []);

    expect(guards.sendBacksPerMergedChange).toBe(0.3333);
  });

  it("reads send-backs and owner minutes as not read, never as a zero, with no change on the arm", () => {
    const guards = armGuards(EVENTS, SPAN, [], []);

    expect(guards).toEqual({
      blockedShare: null,
      sendBacksPerMergedChange: null,
      ownerMinutesPerMergedChange: null,
    });
  });
});
