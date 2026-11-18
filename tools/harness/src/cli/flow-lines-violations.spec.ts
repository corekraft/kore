import { describe, expect, it } from "vitest";
import type { TierViolations, ViolationsByRule } from "../flow/index.js";
import {
  violationLines,
  violationReportLines,
} from "./flow-lines-violations.js";

const row = (fields: Partial<TierViolations> = {}): TierViolations => ({
  failedVerdicts: 0,
  unlabelled: 0,
  citations: 0,
  rules: [],
  ...fields,
});

const NONE: ViolationsByRule = { tiers: {}, unlinked: row() };

describe("violationLines: the cited rule labels of failing verdicts per writer tier", () => {
  it("prints each rule with the count behind its share of the tier's citations", () => {
    const lines = violationLines({
      tiers: {
        "claude-haiku-5-5": row({
          failedVerdicts: 2,
          citations: 3,
          rules: [
            { rule: "max-lines", count: 2, share: 0.6667 },
            { rule: "pin-everything", count: 1, share: 0.3333 },
          ],
        }),
      },
      unlinked: row(),
    });

    expect(lines).toEqual([
      "Review violations by rule, writer tier claude-haiku-5-5: 2 failing verdicts; rules cited: max-lines 2 of 3 (67%), pin-everything 1 of 3 (33%)",
      "Review violations by rule, unlinked row (no writer tier): 0 failing verdicts",
    ]);
  });

  it("says one failing verdict in the singular and names the verdicts that cited no rule label", () => {
    const lines = violationLines({
      tiers: {
        "claude-sonnet-5-5": row({ failedVerdicts: 1, unlabelled: 1 }),
      },
      unlinked: row(),
    });

    expect(lines[0]).toBe(
      "Review violations by rule, writer tier claude-sonnet-5-5: 1 failing verdict; 1 with no rule label",
    );
  });

  it("prints the unlinked row's rules and keeps it apart from the tiers", () => {
    const lines = violationLines({
      tiers: {},
      unlinked: row({
        failedVerdicts: 1,
        citations: 1,
        rules: [{ rule: "fail-closed", count: 1, share: 1 }],
      }),
    });

    expect(lines).toEqual([
      "Review violations by rule, unlinked row (no writer tier): 1 failing verdict; rules cited: fail-closed 1 of 1 (100%)",
    ]);
  });
});

describe("violationReportLines: the split date", () => {
  it("prints only the unsplit lines when the report has no split", () => {
    expect(
      violationReportLines({
        violationsByRule: NONE,
      }),
    ).toEqual([
      "Review violations by rule, unlinked row (no writer tier): 0 failing verdicts",
    ]);
  });

  it("prints the unsplit lines, then each side of the date under a header naming it", () => {
    const after: ViolationsByRule = {
      tiers: {},
      unlinked: row({ failedVerdicts: 2 }),
    };

    expect(
      violationReportLines({
        violationsByRule: NONE,
        violationsByRuleSplit: {
          at: "2026-11-16T00:00:00.000Z",
          before: NONE,
          after,
        },
      }),
    ).toEqual([
      "Review violations by rule, unlinked row (no writer tier): 0 failing verdicts",
      "Review violations by rule by writer tier, before 2026-11-16T00:00:00.000Z:",
      "  Review violations by rule, unlinked row (no writer tier): 0 failing verdicts",
      "Review violations by rule by writer tier, on or after 2026-11-16T00:00:00.000Z:",
      "  Review violations by rule, unlinked row (no writer tier): 2 failing verdicts",
    ]);
  });
});
