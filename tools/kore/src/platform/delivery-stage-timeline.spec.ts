import { expect, test } from "vitest";
import { mergedMilliseconds, stageTimes } from "./delivery-stage-timeline.js";

const MERGE_ERROR =
  "KORE_DELIVERY_MERGED_AT must be an RFC 3339 time, for example 2026-11-18T10:00:00Z";

test("an RFC 3339 merge time with Z or a numeric offset is read as the same instant", () => {
  expect(mergedMilliseconds("2026-11-18T11:00:00+01:00")).toBe(
    mergedMilliseconds("2026-11-18T10:00:00Z"),
  );
});

test.each(["2026-11-18 10:00:00", "Nov 18 2026", "2026-11-18", ""])(
  "the merge time %j, not RFC 3339, is refused naming the variable and an example",
  (mergedAt) => {
    expect(() => mergedMilliseconds(mergedAt)).toThrow(new Error(MERGE_ERROR));
  },
);

test("each stage takes the seconds from the end of the stage before it, and a stage that ended before the merge takes zero", () => {
  const merged = Date.parse("2026-11-18T10:00:00Z");

  expect(
    stageTimes(merged, [
      ["namespace", merged - 3_600_000],
      ["sync", merged + 15_000],
      ["admission", merged + 17_000],
    ]),
  ).toEqual({
    stages: [
      { stage: "namespace", seconds: 0 },
      { stage: "sync", seconds: 15 },
      { stage: "admission", seconds: 2 },
    ],
    totalSeconds: 17,
  });
});

test("stage seconds are rounded to one decimal place", () => {
  const merged = Date.parse("2026-11-18T10:00:00Z");

  expect(stageTimes(merged, [["sync", merged + 1_234]])).toEqual({
    stages: [{ stage: "sync", seconds: 1.2 }],
    totalSeconds: 1.2,
  });
});
