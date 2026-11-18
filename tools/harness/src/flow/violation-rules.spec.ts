import { beforeEach, describe, expect, it, vi } from "vitest";
import { verdictsOf, type Verdict } from "./review-heads.js";
import {
  HAIKU,
  linkWriters,
  resetReadings,
  SONNET,
  SPAN,
  TIERS,
} from "./review-rounds-support.js";
import { violationsByRuleIn } from "./violation-rules.js";

vi.mock("./github-waits.js");
vi.mock("./review-heads.js");
vi.mock("./scope.js");
vi.mock("./writer-join.js");
vi.mock("./writer-tier-figures.js");

/** A principles-review verdict for a PR head, with the short rule labels `review post` recorded. */
const verdict = (
  number: number,
  head: string,
  findings: number | undefined,
  rules: string[],
  at = 100,
): Verdict => ({ number, head, at, findings, rules });

const read = (verdicts: Verdict[]) => {
  vi.mocked(verdictsOf).mockReturnValue(verdicts);
  return violationsByRuleIn([], SPAN, TIERS);
};

beforeEach(resetReadings);

describe("violations by rule: the cited rule labels of failing verdicts, per writer tier", () => {
  it("counts each cited label per tier with the count behind its share of the tier's citations", () => {
    linkWriters([
      [100, "h-writer"],
      [101, "h-writer"],
    ]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 2, ["max-lines", "pin-everything"]),
      verdict(101, "bbbbbbb", 1, ["max-lines"]),
    ]);

    expect(tiers[HAIKU]).toEqual({
      failedVerdicts: 2,
      unlabelled: 0,
      citations: 3,
      rules: [
        { rule: "max-lines", count: 2, share: 0.6667 },
        { rule: "pin-everything", count: 1, share: 0.3333 },
      ],
    });
  });

  it("keeps the tiers apart, each with its own total", () => {
    linkWriters([
      [100, "h-writer"],
      [200, "s-writer"],
    ]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 1, ["max-lines"]),
      verdict(200, "bbbbbbb", 1, ["fail-closed"]),
    ]);

    expect(tiers[HAIKU]?.rules).toEqual([
      { rule: "max-lines", count: 1, share: 1 },
    ]);
    expect(tiers[SONNET]?.rules).toEqual([
      { rule: "fail-closed", count: 1, share: 1 },
    ]);
  });

  it("orders rules by count, most first, and by label where counts tie", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 3, ["zeta", "alpha", "mid"]),
      verdict(100, "bbbbbbb", 1, ["mid"]),
    ]);

    expect(tiers[HAIKU]?.rules.map((r) => r.rule)).toEqual([
      "mid",
      "alpha",
      "zeta",
    ]);
  });
});

describe("violations by rule: which verdicts are read", () => {
  it("does not count a clean verdict or a verdict with no recorded count", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 0, ["max-lines"]),
      verdict(100, "bbbbbbb", undefined, ["max-lines"]),
    ]);

    expect(tiers[HAIKU]).toEqual({
      failedVerdicts: 0,
      unlabelled: 0,
      citations: 0,
      rules: [],
    });
  });

  it("counts a failing verdict with no label as unlabelled and adds no citation", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([verdict(100, "aaaaaaa", 2, [])]);

    expect(tiers[HAIKU]).toEqual({
      failedVerdicts: 1,
      unlabelled: 1,
      citations: 0,
      rules: [],
    });
  });
});

describe("violations by rule: one count per head and per verdict", () => {
  it("counts a head once however many verdicts name it, the latest verdict's labels standing", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 1, ["max-lines"], 100),
      verdict(100, "aaaaaaa", 1, ["pin-everything"], 200),
    ]);

    expect(tiers[HAIKU]?.failedVerdicts).toBe(1);
    expect(tiers[HAIKU]?.rules).toEqual([
      { rule: "pin-everything", count: 1, share: 1 },
    ]);
  });

  it("counts a label once in a verdict that cites it twice", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 2, ["max-lines", "max-lines"]),
    ]);

    expect(tiers[HAIKU]?.rules).toEqual([
      { rule: "max-lines", count: 1, share: 1 },
    ]);
  });

  it("reads only verdicts recorded in the span", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers } = read([
      verdict(100, "aaaaaaa", 1, ["max-lines"], 5000),
      verdict(100, "bbbbbbb", 1, ["fail-closed"], 999),
    ]);

    expect(tiers[HAIKU]?.rules).toEqual([
      { rule: "fail-closed", count: 1, share: 1 },
    ]);
  });

  it("puts a verdict on a pull request with no linked writer in the unlinked row and gives it no tier", () => {
    linkWriters([[100, "h-writer"]]);

    const { tiers, unlinked } = read([
      verdict(999, "aaaaaaa", 1, ["max-lines"]),
    ]);

    expect(unlinked).toEqual({
      failedVerdicts: 1,
      unlabelled: 0,
      citations: 1,
      rules: [{ rule: "max-lines", count: 1, share: 1 }],
    });
    expect(tiers[HAIKU]?.failedVerdicts).toBe(0);
    expect(tiers[SONNET]?.failedVerdicts).toBe(0);
  });

  it("gives every given tier a row, empty where it has no failing verdict", () => {
    const { tiers } = read([]);

    expect(Object.keys(tiers)).toEqual(TIERS);
    expect(tiers[SONNET]).toEqual({
      failedVerdicts: 0,
      unlabelled: 0,
      citations: 0,
      rules: [],
    });
  });
});
