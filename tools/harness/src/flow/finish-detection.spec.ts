import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { finishDetection } from "./finish-detection.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
const MINUTE = 60_000;
/** The report window is the eleventh day. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const AT = 10 * DAY;

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A session.result the Stop hook recorded on a pane. */
const result = (ms: number, pane = "w3:p9") =>
  event(ms, "session.result", { pane, result: "done" });

/** A pane.finished session wait recorded on a pane. */
const finished = (ms: number, pane = "w3:p9") =>
  event(ms, "pane.finished", { source: "herdr", pane, result: "done" });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
});

describe("finish detection: a result is detected by a finish on its pane", () => {
  it("counts a result detected by a pane.finished within five minutes, with the lag from the result", () => {
    expect(
      finishDetection([result(AT), finished(AT + 30_000)], WINDOW),
    ).toEqual({
      windowSeconds: 300,
      results: 1,
      detected: 1,
      undetected: 0,
      medianLagSeconds: 30,
    });
  });

  it("counts a result with no pane.finished within five minutes as undetected", () => {
    expect(
      finishDetection([result(AT), finished(AT + 5 * MINUTE + 1)], WINDOW),
    ).toEqual({
      windowSeconds: 300,
      results: 1,
      detected: 0,
      undetected: 1,
      medianLagSeconds: null,
    });
  });

  it("does not let a finish on another pane detect the result", () => {
    expect(
      finishDetection([result(AT), finished(AT + 1000, "w3:p1")], WINDOW),
    ).toMatchObject({ results: 1, detected: 0, undetected: 1 });
  });

  it("counts a finish the wait saw before the Stop hook recorded the result as detected, with no lag", () => {
    expect(
      finishDetection([finished(AT - 10_000), result(AT)], WINDOW),
    ).toMatchObject({ detected: 1, undetected: 0, medianLagSeconds: 0 });
  });

  it("lets one finish detect one result only", () => {
    expect(
      finishDetection(
        [result(AT), result(AT + MINUTE), finished(AT + 20_000)],
        WINDOW,
      ),
    ).toMatchObject({ results: 2, detected: 1, undetected: 1 });
  });

  it("gives the median lag, averaged over the two middle lags when the count is even", () => {
    const lags = [10_000, 20_000, 30_000, 40_000];
    expect(
      finishDetection(
        lags.flatMap((lag, i) => [
          result(AT + i * MINUTE),
          finished(AT + i * MINUTE + lag),
        ]),
        WINDOW,
      ),
    ).toMatchObject({ detected: 4, medianLagSeconds: 25 });
  });
});

describe("finish detection: what is left out of the count", () => {
  it("counts only the results inside the window", () => {
    expect(
      finishDetection([result(9 * DAY), result(11 * DAY + 1)], WINDOW),
    ).toMatchObject({ results: 0, undetected: 0 });
  });

  it("counts no result that names no pane, since no pane.finished can detect it", () => {
    expect(
      finishDetection(
        [event(AT, "session.result", { result: "done" })],
        WINDOW,
      ),
    ).toMatchObject({ results: 0, undetected: 0 });
  });

  it("ignores every kind other than session.result and pane.finished", () => {
    expect(
      finishDetection(
        [event(AT, "session.stop", { pane: "w3:p9" }), finished(AT)],
        WINDOW,
      ),
    ).toMatchObject({ results: 0, detected: 0, undetected: 0 });
  });
});
