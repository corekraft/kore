import { describe, expect, it, vi } from "vitest";
import type { Checks } from "./checks.js";
import { summary, type Report } from "./precheck.js";

// The summary only formats a report; the precheck's collaborators are mocked
// here as in its spec, so this unit runs alone.
vi.mock("./checks.js");
vi.mock("./declaration.js");
vi.mock("./diff.js");
vi.mock("./hints.js");
vi.mock("./manifest-source.js");
vi.mock("./verdict.js");

const CHECKS: Checks = {
  ci: { result: "pass" },
  scan: { result: "pass" },
  coverage: { result: "pass" },
  principlesReview: { result: "fail", detail: "2 violations" },
};

const REVIEWERS = ["reviewer-bot"];

describe("summary of a PR that stopped at the declaration", () => {
  it("is two lines: not ready, and the reason the declaration is invalid", () => {
    const report: Report = {
      pr: 42,
      ok: false,
      reviewers: REVIEWERS,
      pattern: undefined,
      idea: undefined,
      declaration: { ok: false, reason: "The PR declares no safety pattern." },
    };
    expect(summary(report)).toBe(
      "PR #42: not ready\nThe PR declares no safety pattern.\n",
    );
  });
});

describe("summary of a PR the precheck read in full", () => {
  it("lists the pattern and idea, each check, the hints, the mismatch and what is unverified", () => {
    const report: Report = {
      pr: 42,
      ok: false,
      head: "abc1234",
      reviewers: REVIEWERS,
      pattern: "feature-flagged",
      idea: "#10",
      declaration: { ok: true },
      checks: CHECKS,
      hints: { flags: [] },
      patternMatches: false,
      patternMismatch: "feature-flagged, but the diff adds no flag",
      clusterFacing: true,
      unverified: ["gating not verified"],
    };
    expect(summary(report)).toBe(
      [
        "PR #42: not ready",
        "pattern: feature-flagged (idea #10)",
        "reviewers: reviewer-bot",
        "ci: pass",
        "scan: pass",
        "coverage: pass",
        "principlesReview: fail (2 violations)",
        "hint flags: []",
        "pattern mismatch: feature-flagged, but the diff adds no flag",
        "cluster-facing: true",
        "unverified: gating not verified",
        "",
      ].join("\n"),
    );
  });

  it("says ready for the judge and names no pattern when none was declared", () => {
    const report: Report = {
      pr: 7,
      ok: true,
      reviewers: [],
      pattern: undefined,
      idea: undefined,
      declaration: { ok: true },
      checks: CHECKS,
      hints: {},
      clusterFacing: false,
      unverified: [],
    };
    expect(summary(report)).toBe(
      [
        "PR #7: ready for the judge",
        "pattern: none",
        "reviewers: ",
        "ci: pass",
        "scan: pass",
        "coverage: pass",
        "principlesReview: fail (2 violations)",
        "cluster-facing: false",
        "",
      ].join("\n"),
    );
  });
});
