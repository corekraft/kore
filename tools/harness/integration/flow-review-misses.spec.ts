import { describe, expect, it } from "vitest";
import { run } from "../src/cli/index.js";
import {
  LEDGER_FILE as DEFAULT,
  ledgerHarness as harness,
} from "../src/testing/index.js";

const at = (day: string) => `2026-01-${day}T12:00:00.000Z`;

/** A stored review.run for a PR, with the findings count only when the verdict recorded one. */
function review(
  id: string,
  day: string,
  number: number,
  label: string,
  findings?: number,
) {
  return {
    schema: 1,
    id,
    source: "claude",
    kind: "review.run",
    occurredAt: at(day),
    recordedAt: at(day),
    number,
    label,
    stage: "review",
    ...(findings === undefined ? {} : { findings }),
  };
}

/** A stored judge send-back on a PR, with its category. */
function sendBack(id: string, day: string, number: number, category: string) {
  return {
    schema: 1,
    id,
    source: "github",
    kind: "send-back",
    occurredAt: at(day),
    recordedAt: at(day),
    number,
    label: "too slow",
    category,
  };
}

const RANGE = [
  "--since",
  "2026-01-10T00:00:00Z",
  "--until",
  "2026-01-17T00:00:00Z",
  "--as-of",
  "2026-01-20T00:00:00Z",
];

describe("flow report review misses, from the ledger (#851)", () => {
  it("counts the clean reviews a rule-break send-back followed, and the reviews that found a violation, against the trailing days", async () => {
    const h = harness();
    const events = [
      // The trailing days before the range: one clean review, nothing later.
      review("t1", "04", 46, "posted:5555555", 0),
      // In the range: a clean review sent back for a rule break later.
      review("w1", "11", 42, "posted:1111111", 0),
      sendBack("s1", "12", 42, "rule-break"),
      // In the range: a review that found a violation.
      review("w2", "12", 43, "posted:2222222", 2),
      // In the range: a clean review that nothing sent back.
      review("w3", "13", 44, "posted:3333333", 0),
      // In the range: a review from before the verdict was recorded.
      review("w4", "13", 45, "posted:4444444"),
      // In the range: a failed review, which posts no verdict.
      review("w5", "14", 47, "failed:no verdict"),
    ];
    h.fs.files.set(
      DEFAULT,
      events.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );

    expect(await run(["flow", "report", "--json", ...RANGE], h.deps)).toBe(0);
    const { reviewMisses } = JSON.parse(h.out()) as Record<string, unknown>;

    expect(reviewMisses).toEqual({
      trailingDays: 7,
      reviews: 3,
      unrecorded: 1,
      passedRuleBreak: {
        count: 1,
        ratio: 0.3333,
        trailingAverage: 0,
        worsened: true,
      },
      foundViolation: { count: 1, share: 0.3333, trailingAverage: 0 },
    });
  });

  it("prints both review figures in the human report, with the trailing average", async () => {
    const h = harness();
    h.fs.files.set(
      DEFAULT,
      `${JSON.stringify(review("w1", "11", 42, "posted:1111111", 0))}\n${JSON.stringify(sendBack("s1", "12", 42, "rule-break"))}\n`,
    );

    expect(await run(["flow", "report", ...RANGE], h.deps)).toBe(0);
    expect(h.out()).toContain(
      "Passed reviews later sent back for a rule break: 1 of 1 reviews (100%), no reviews in the trailing days",
    );
    expect(h.out()).toContain(
      "Reviews that found a violation: 0 of 1 (0%), no reviews in the trailing days",
    );
  });
});
