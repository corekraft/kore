import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import {
  REPO,
  live,
  mutations,
  rulesetRepo,
} from "../testing/ruleset-support.js";

const suite = (id: number, evaluation: string, result = "pass") => ({
  id,
  actor_name: "junners",
  ref: "refs/heads/main",
  result,
  evaluation_result: evaluation,
});

const detail = (
  evaluations: {
    rule_type: string;
    enforcement: string;
    result: string;
    ruleset: number;
  }[],
) => ({
  rule_evaluations: evaluations.map((e) => ({
    rule_source: { type: "ruleset", id: e.ruleset, name: "main" },
    enforcement: e.enforcement,
    result: e.result,
    rule_type: e.rule_type,
  })),
});

const insights = (...flags: string[]) => [
  "ruleset",
  "insights",
  "--repo",
  REPO,
  "--target",
  "main",
  ...flags,
];
const answers = () => [
  {
    match: (_c: string, a: readonly string[]) =>
      a[1]?.startsWith(`repos/${REPO}/rulesets/rule-suites?`) === true,
    result: {
      stdout: JSON.stringify([
        suite(1, "fail"),
        suite(2, "pass"),
        suite(3, "fail"),
      ]),
    },
  },
  {
    match: (_c: string, a: readonly string[]) =>
      a[1] === `repos/${REPO}/rulesets/rule-suites/1`,
    result: {
      stdout: JSON.stringify(
        detail([
          {
            rule_type: "required_status_checks",
            enforcement: "evaluate",
            result: "fail",
            ruleset: 7,
          },
          {
            rule_type: "deletion",
            enforcement: "active",
            result: "pass",
            ruleset: 7,
          },
        ]),
      ),
    },
  },
  {
    match: (_c: string, a: readonly string[]) =>
      a[1] === `repos/${REPO}/rulesets/rule-suites/3`,
    result: {
      stdout: JSON.stringify(
        detail([
          {
            rule_type: "required_status_checks",
            enforcement: "evaluate",
            result: "fail",
            ruleset: 7,
          },
          {
            rule_type: "pull_request",
            enforcement: "evaluate",
            result: "fail",
            ruleset: 99,
          },
        ]),
      ),
    },
  },
];

describe("harness ruleset insights", () => {
  it("summarizes evaluate firings of the target ruleset by rule, for the activation request", async () => {
    const h = rulesetRepo("audit", live("evaluate"), answers());
    expect(await run([...insights(), "--json"], h.deps)).toBe(0);
    expect(JSON.parse(h.out())).toEqual({
      repo: REPO,
      target: "main",
      timePeriod: "week",
      suites: 3,
      firings: 2,
      byRule: { required_status_checks: 2 },
      actors: ["junners"],
      truncated: false,
    });
  });

  it("prints a readable summary and mutates nothing", async () => {
    const h = rulesetRepo("audit", live("evaluate"), answers());
    expect(await run(insights(), h.deps)).toBe(0);
    expect(h.out()).toMatch(/2 evaluate firings/);
    expect(h.out()).toMatch(/required_status_checks\s+2/);
    expect(mutations(h)).toEqual([]);
  });

  it("reports no firings as a clean pass, not an error", async () => {
    const h = rulesetRepo("audit", live("evaluate"), [
      {
        match: (_c, a) =>
          a[1]?.startsWith(`repos/${REPO}/rulesets/rule-suites?`) === true,
        result: { stdout: "[]" },
      },
    ]);
    expect(await run(insights(), h.deps)).toBe(0);
    expect(h.out()).toMatch(/0 evaluate firings/);
  });

  it("refuses an unknown --time-period", async () => {
    const h = rulesetRepo("audit", live("evaluate"));
    expect(await run(insights("--time-period", "year"), h.deps)).toBe(1);
    expect(h.err()).toMatch(/hour, day, week, month/);
  });

  it("says when the period held more suites than one page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => suite(i + 1, "pass"));
    const h = rulesetRepo("audit", live("evaluate"), [
      {
        match: (_c, a) =>
          a[1]?.startsWith(`repos/${REPO}/rulesets/rule-suites?`) === true,
        result: { stdout: JSON.stringify(full) },
      },
    ]);
    expect(await run(insights(), h.deps)).toBe(0);
    expect(h.out()).toMatch(/Truncated/);
  });
});
