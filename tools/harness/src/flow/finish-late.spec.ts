import { describe, expect, it } from "vitest";
import { splitUndetected } from "./finish-late.js";

const MINUTE = 60_000;
const AT = 10_000_000;

const result = (at: number, pane = "w3:p9") => ({ pane, at });
const finish = (at: number, pane = "w3:p9", used = false) => ({
  pane,
  at,
  used,
});

describe("finish split: an undetected result is never noticed or late", () => {
  it("reports a result whose pane has no pane.finished at all as never noticed", () => {
    expect(splitUndetected([result(AT)], [])).toEqual({
      neverNoticed: 1,
      late: 0,
      lagSeconds: [],
    });
  });

  it("does not count a finish on another pane as a finish on the result's pane", () => {
    expect(
      splitUndetected([result(AT)], [finish(AT + 20 * MINUTE, "w3:p1")]),
    ).toEqual({ neverNoticed: 1, late: 0, lagSeconds: [] });
  });

  it("reports a result whose pane has a finish outside the window as late, with the lag from the result", () => {
    expect(splitUndetected([result(AT)], [finish(AT + 20 * MINUTE)])).toEqual({
      neverNoticed: 0,
      late: 1,
      lagSeconds: [1200],
    });
  });

  it("reports a result as late with no lag when every finish on its pane is already used", () => {
    expect(
      splitUndetected([result(AT)], [finish(AT + MINUTE, "w3:p9", true)]),
    ).toEqual({ neverNoticed: 0, late: 1, lagSeconds: [] });
  });

  it("gives each finish to one late result only, the earlier result first", () => {
    expect(
      splitUndetected(
        [result(AT + MINUTE), result(AT)],
        [finish(AT + 30 * MINUTE)],
      ),
    ).toEqual({ neverNoticed: 0, late: 2, lagSeconds: [30 * 60] });
  });

  it("reads a finish that came before the result as no lag", () => {
    expect(splitUndetected([result(AT)], [finish(AT - 20 * MINUTE)])).toEqual({
      neverNoticed: 0,
      late: 1,
      lagSeconds: [0],
    });
  });
});
