import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport } from "../flow/index.js";
import type { FlowReport } from "../flow/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { readMetric } from "./judge.js";
import { measureChange } from "./measure.js";

vi.mock("../flow/index.js");
vi.mock("./judge.js");

const DAY = 86_400_000;
const CHANGED = new Date("2026-11-01T00:00:00Z");
const event = (occurredAt: string) => ({ occurredAt }) as LedgerEvent;

describe("measureChange", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(buildReport).mockReturnValue({} as FlowReport);
  });

  it("reads the metric over the window before the change and the window after it", () => {
    vi.mocked(readMetric).mockReturnValueOnce(10).mockReturnValueOnce(7);
    const events = [
      event("2026-10-28T00:00:00Z"),
      event("2026-11-02T00:00:00Z"),
    ];
    const measured = measureChange(events, {
      metric: "leadTime.medianSeconds",
      changedAt: CHANGED,
      windowDays: 7,
    });
    expect(measured).toEqual({ before: 10, after: 7 });
    const [before, after] = vi.mocked(buildReport).mock.calls;
    expect(before?.[0]).toBe(events);
    expect(before?.[1]).toMatchObject({
      since: new Date(CHANGED.getTime() - 7 * DAY),
      until: CHANGED,
      asOf: CHANGED,
    });
    expect(after?.[1]).toMatchObject({
      since: CHANGED,
      until: new Date(CHANGED.getTime() + 7 * DAY),
      asOf: new Date(CHANGED.getTime() + 7 * DAY),
    });
    expect(vi.mocked(readMetric).mock.calls.map((c) => c[1])).toEqual([
      "leadTime.medianSeconds",
      "leadTime.medianSeconds",
    ]);
  });

  it("has no baseline when the ledger recorded nothing before the change", () => {
    vi.mocked(readMetric).mockReturnValue(0);
    const measured = measureChange([event("2026-11-02T00:00:00Z")], {
      metric: "outcomes.mainRed.rate",
      changedAt: CHANGED,
      windowDays: 7,
    });
    expect(measured.before).toBeNull();
    expect(measured.after).toBe(0);
  });

  it("has no outcome figure when nothing was recorded after the change", () => {
    vi.mocked(readMetric).mockReturnValue(0);
    const measured = measureChange([event("2026-10-30T00:00:00Z")], {
      metric: "outcomes.mainRed.rate",
      changedAt: CHANGED,
      windowDays: 7,
    });
    expect(measured.after).toBeNull();
    expect(measured.before).toBe(0);
  });

  it("ignores events outside the baseline window when deciding it has history", () => {
    vi.mocked(readMetric).mockReturnValue(3);
    const measured = measureChange([event("2026-10-01T00:00:00Z")], {
      metric: "m",
      changedAt: CHANGED,
      windowDays: 7,
    });
    expect(measured.before).toBeNull();
  });
});
