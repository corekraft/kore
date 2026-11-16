import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { drawSample, resampleCandidates } from "./resample.js";
import { VERDICT_HEAD_LENGTH } from "./review-verdict.js";

const HEAD_A = "aaaaaaa1111111aaaaaaa1111111aaaaaaa11111";
const HEAD_B = "bbbbbbb2222222bbbbbbb2222222bbbbbbb22222";

/** A ledger event with the fields the sample reads; everything else is left out. */
function ev(
  id: number,
  kind: string,
  over: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(id),
    recordedAt: `2026-11-01T00:00:${String(id % 60).padStart(2, "0")}.000Z`,
    occurredAt: `2026-11-01T00:00:${String(id % 60).padStart(2, "0")}.000Z`,
    source: "claude",
    kind,
    ...over,
  } as LedgerEvent;
}

const passed = (id: number, number: number, head: string, label = "posted") =>
  ev(id, "review.run", { number, label: `${label}:${head}`, findings: 0 });

const merged = (id: number, number: number) => ev(id, "pr.merged", { number });

describe("resampleCandidates (#852)", () => {
  it("offers a passed review of a merged PR, naming its PR and head", () => {
    const events = [passed(1, 10, HEAD_A), merged(2, 10)];

    expect(resampleCandidates(events)).toEqual([
      { pr: 10, head: HEAD_A.slice(0, VERDICT_HEAD_LENGTH) },
    ]);
  });

  it("counts an unchanged verdict as a passed review too", () => {
    const events = [passed(1, 10, HEAD_A, "unchanged"), merged(2, 10)];

    expect(resampleCandidates(events)).toEqual([
      { pr: 10, head: HEAD_A.slice(0, VERDICT_HEAD_LENGTH) },
    ]);
  });

  it("leaves out a review that found a violation, so only passed reviews are re-reviewed", () => {
    const events = [
      ev(1, "review.run", {
        number: 10,
        label: `posted:${HEAD_A}`,
        findings: 2,
      }),
      merged(2, 10),
    ];

    expect(resampleCandidates(events)).toEqual([]);
  });

  it("leaves out a passed review of a PR that has not merged", () => {
    expect(resampleCandidates([passed(1, 10, HEAD_A)])).toEqual([]);
  });

  it("leaves out a review from before its findings were recorded, since it did not pass", () => {
    const events = [
      ev(1, "review.run", { number: 10, label: `posted:${HEAD_A}` }),
      merged(2, 10),
    ];

    expect(resampleCandidates(events)).toEqual([]);
  });

  it("leaves out a PR head already re-reviewed, whether the re-review passed or failed", () => {
    const events = [
      passed(1, 10, HEAD_A),
      passed(2, 11, HEAD_B),
      ev(3, "review.run", {
        number: 10,
        label: `resample:${HEAD_A.slice(0, VERDICT_HEAD_LENGTH)}`,
        findings: 0,
      }),
      ev(4, "review.run", {
        number: 11,
        label: `resample-failed:${HEAD_B.slice(0, VERDICT_HEAD_LENGTH)}`,
      }),
      merged(5, 10),
      merged(6, 11),
    ];

    expect(resampleCandidates(events)).toEqual([]);
  });
});

describe("resampleCandidates heads and order (#852)", () => {
  it("offers each PR head once, by its first passed verdict, even when the verdict was posted again", () => {
    const events = [
      passed(1, 10, HEAD_A),
      passed(2, 10, HEAD_A, "unchanged"),
      merged(3, 10),
    ];

    expect(resampleCandidates(events)).toEqual([
      { pr: 10, head: HEAD_A.slice(0, VERDICT_HEAD_LENGTH) },
    ]);
  });

  it("offers the passed heads of one PR separately, earliest verdict first", () => {
    const events = [
      passed(2, 10, HEAD_B),
      passed(1, 10, HEAD_A),
      merged(3, 10),
    ];

    expect(resampleCandidates(events)).toEqual([
      { pr: 10, head: HEAD_A.slice(0, VERDICT_HEAD_LENGTH) },
      { pr: 10, head: HEAD_B.slice(0, VERDICT_HEAD_LENGTH) },
    ]);
  });

  it("ignores a failed review run, which posted no verdict", () => {
    const events = [
      ev(1, "review.run", { number: 10, label: "failed:blocked" }),
      merged(2, 10),
    ];

    expect(resampleCandidates(events)).toEqual([]);
  });
});

describe("drawSample (#852)", () => {
  it("returns the whole pool, in order, when it holds no more than the size", () => {
    expect(drawSample(["a", "b"], 5, () => 0.99)).toEqual(["a", "b"]);
  });

  it("returns exactly the size, never more, and no item twice", () => {
    const sample = drawSample(["a", "b", "c", "d", "e", "f"], 3, () => 0.5);

    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3);
  });

  it("draws the item the random number picks, so a fixed sequence gives a fixed sample", () => {
    const values = [0, 0, 0];
    const random = () => values.shift() ?? 0;

    expect(drawSample(["a", "b", "c", "d"], 2, random)).toEqual(["a", "b"]);
  });

  it("never reads the pool it was given, so the caller's list is unchanged", () => {
    const pool = ["a", "b", "c"];
    drawSample(pool, 2, () => 0);

    expect(pool).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for an empty pool or a size of zero", () => {
    expect(drawSample([], 5, () => 0.5)).toEqual([]);
    expect(drawSample(["a", "b"], 0, () => 0.5)).toEqual([]);
  });
});
