import { describe, expect, it } from "vitest";
import { RulesetError } from "./declared.js";
import { PAGE } from "./github.js";
import { summarize, type Subject } from "./insights.js";
import {
  REPO,
  asGitHub,
  fakeGitHub,
  type FakeGitHub,
} from "./ruleset-support.js";

const SUBJECT: Subject = {
  repo: REPO,
  target: "main",
  ruleset: "main-candidate",
  targetId: 8,
  timePeriod: "week",
};

const suite = (id: number, evaluation: string, actor?: string) => ({
  id,
  ...(actor === undefined ? {} : { actor_name: actor }),
  evaluation_result: evaluation,
});

/** A suite detail with one rule evaluation per entry: the rule type, the ruleset id, and its result. */
const detail = (...evaluations: [string, number, string][]) => ({
  rule_evaluations: evaluations.map(([rule_type, id, result]) => ({
    rule_source: { type: "ruleset", id, name: `ruleset-${id}` },
    enforcement: "evaluate",
    result,
    rule_type,
  })),
});

/** A GitHub fake whose listing and details are the given rows and rule evaluations by suite id. */
function githubWith(list: unknown[], details: Record<number, unknown> = {}) {
  const github: FakeGitHub = fakeGitHub();
  github.suites.mockResolvedValue(list as never[]);
  github.suite.mockImplementation((id) =>
    Promise.resolve((details[id] ?? {}) as never),
  );
  return github;
}

describe("summarize counts the evaluate firings of the target ruleset by rule", () => {
  it("counts a suite once for the target's failing rules and lists its actor", async () => {
    const github = githubWith(
      [suite(1, "fail", "junners"), suite(2, "pass"), suite(3, "fail")],
      {
        1: detail(
          ["required_status_checks", 8, "fail"],
          ["deletion", 8, "pass"],
        ),
        3: detail(
          ["required_status_checks", 8, "fail"],
          ["pull_request", 99, "fail"],
        ),
      },
    );
    expect(await summarize(asGitHub(github), SUBJECT)).toEqual({
      repo: REPO,
      target: "main",
      ruleset: "main-candidate",
      timePeriod: "week",
      suites: 3,
      firings: 2,
      byRule: { required_status_checks: 2 },
      actors: ["junners"],
      truncated: false,
    });
  });

  it("reads the detail of each failing suite and no passing one", async () => {
    const github = githubWith([suite(1, "fail"), suite(2, "pass")]);
    await summarize(asGitHub(github), SUBJECT);
    expect(github.suites.mock.calls).toEqual([["week"]]);
    expect(github.suite.mock.calls).toEqual([[1]]);
  });

  it("matches the target by id when the ruleset has one, and by name when it has none", async () => {
    const details = { 1: detail(["deletion", 8, "fail"]) };
    const byId = githubWith([suite(1, "fail")], details);
    expect((await summarize(asGitHub(byId), SUBJECT)).firings).toBe(1);
    const byName = githubWith([suite(1, "fail")], {
      1: {
        rule_evaluations: [
          {
            rule_source: { name: "main-candidate" },
            enforcement: "evaluate",
            result: "fail",
            rule_type: "deletion",
          },
        ],
      },
    });
    const unnamed = await summarize(asGitHub(byName), {
      ...SUBJECT,
      targetId: undefined,
    });
    expect(unnamed.byRule).toEqual({ deletion: 1 });
  });

  it("counts a rule type once per suite, even when the suite fails it twice", async () => {
    const github = githubWith([suite(1, "fail")], {
      1: detail(["deletion", 8, "fail"], ["deletion", 8, "fail"]),
    });
    const result = await summarize(asGitHub(github), SUBJECT);
    expect(result).toMatchObject({ firings: 1, byRule: { deletion: 1 } });
  });
});

describe("summarize reports a period with nothing to count as a clean pass", () => {
  it("reports zero firings and reads no detail when no suite failed", async () => {
    const github = githubWith([suite(1, "pass")]);
    expect(await summarize(asGitHub(github), SUBJECT)).toMatchObject({
      suites: 1,
      firings: 0,
      byRule: {},
      actors: [],
    });
    expect(github.suite).not.toHaveBeenCalled();
  });

  it("counts a firing whose suite names no actor, and lists no actor for it", async () => {
    const github = githubWith([suite(1, "fail")], {
      1: detail(["deletion", 8, "fail"]),
    });
    expect(await summarize(asGitHub(github), SUBJECT)).toMatchObject({
      firings: 1,
      actors: [],
    });
  });

  it("lists each actor once, sorted", async () => {
    const github = githubWith(
      [
        suite(1, "fail", "zed"),
        suite(2, "fail", "amy"),
        suite(3, "fail", "zed"),
      ],
      {
        1: detail(["deletion", 8, "fail"]),
        2: detail(["deletion", 8, "fail"]),
        3: detail(["deletion", 8, "fail"]),
      },
    );
    expect((await summarize(asGitHub(github), SUBJECT)).actors).toEqual([
      "amy",
      "zed",
    ]);
  });

  it("says the counts are a floor when the period filled a page", async () => {
    const full = Array.from({ length: PAGE }, (_, i) => suite(i + 1, "pass"));
    expect(
      (await summarize(asGitHub(githubWith(full)), SUBJECT)).truncated,
    ).toBe(true);
  });
});

describe("summarize skips GitHub data that does not fit, and refuses a suite it cannot read", () => {
  it("refuses a failing suite without a numeric id, naming the fix", async () => {
    const github = githubWith([{ ...suite(1, "fail"), id: "one" }]);
    await expect(summarize(asGitHub(github), SUBJECT)).rejects.toThrow(
      new RulesetError(
        "GitHub listed a rule suite without a numeric id, so its rules cannot be read. Check `gh --version`, then rerun.",
      ),
    );
  });

  it("skips listed entries and evaluations that are not objects or lack a usable field", async () => {
    const github = githubWith([null, "x", 3, suite(1, "fail")], {
      1: {
        rule_evaluations: [
          null,
          "x",
          { rule_source: "x", enforcement: "evaluate", result: "fail" },
          {
            rule_source: { id: 8 },
            enforcement: "evaluate",
            result: "fail",
            rule_type: 5,
          },
          {
            rule_source: { id: 8 },
            enforcement: "evaluate",
            result: "fail",
            rule_type: "deletion",
          },
        ],
      },
    });
    expect(await summarize(asGitHub(github), SUBJECT)).toMatchObject({
      suites: 4,
      firings: 1,
      byRule: { deletion: 1 },
    });
  });

  it("reads a detail without a rule_evaluations list as no firing", async () => {
    const github = githubWith([suite(1, "fail")], {
      1: { rule_evaluations: "none" },
    });
    expect(await summarize(asGitHub(github), SUBJECT)).toMatchObject({
      firings: 0,
      byRule: {},
    });
  });
});
