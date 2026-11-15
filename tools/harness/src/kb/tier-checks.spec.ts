// A model-tier idea (#218) declares cost and judge send-backs together; kb-check refuses one that declares only cost.
import { beforeEach, expect, test, vi } from "vitest";
import { finding, type Finding } from "./markdown.js";
import { tierProblems } from "./tier-checks.js";

vi.mock("./markdown.js");
vi.mock("../idea/index.js", () => ({
  TIER_COST_METRIC: "metrics.tokensPerIdea",
  TIER_GUARD_METRIC: "rework.sendBacksPerIdea",
  TIER_FIELDS: ["model", "effort"],
}));

const FILE = "docs/ideas/0001-a.md";
const METRICS = ["metrics.tokensPerIdea", "rework.sendBacksPerIdea"];
const PROBLEM: Finding = { file: "", line: 0, message: "", fix: "" };

type Keys = Map<string, { value: string; line: number }>;
const keys = (over: Record<string, string | null> = {}): Keys => {
  const base: Record<string, string> = {
    kind: "harness",
    "hypothesis-metric": "metrics.tokensPerIdea",
    "hypothesis-direction": "down",
    "tier-change": "model",
    "guard-metric": "rework.sendBacksPerIdea",
  };
  const map: Keys = new Map();
  let line = 8;
  for (const [key, value] of Object.entries({ ...base, ...over })) {
    if (value !== null) {
      map.set(key, { value, line: line++ });
    }
  }
  return map;
};
const messages = () => vi.mocked(finding).mock.calls.map((c) => c.slice(1));

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM);
});

test("a tier idea declaring cost and send-backs is clean", () => {
  expect(tierProblems(FILE, keys(), METRICS)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("an idea with no tier change and no guard metric is not a tier idea and needs nothing", () => {
  expect(
    tierProblems(
      FILE,
      keys({ "tier-change": null, "guard-metric": null }),
      METRICS,
    ),
  ).toEqual([]);
});

test("a tier idea that declares only cost is rejected, naming the missing send-backs metric", () => {
  tierProblems(FILE, keys({ "guard-metric": null }), METRICS);
  expect(messages()).toEqual([
    [
      11,
      "frontmatter guard-metric is missing for a tier idea; a tier change is measured on cost and judge send-backs together",
      "add guard-metric: rework.sendBacksPerIdea",
    ],
  ]);
});

test("a guard metric that is not judge send-backs is rejected", () => {
  tierProblems(FILE, keys({ "guard-metric": "friction.total" }), METRICS);
  expect(messages()).toEqual([
    [
      12,
      "frontmatter guard-metric is friction.total, not the judge send-backs metric",
      "use rework.sendBacksPerIdea",
    ],
  ]);
});

test("a tier idea whose hypothesis is not tokens per idea going down is rejected", () => {
  tierProblems(
    FILE,
    keys({
      "hypothesis-metric": "friction.total",
      "hypothesis-direction": "up",
    }),
    METRICS,
  );
  expect(messages()).toEqual([
    [
      9,
      "frontmatter hypothesis-metric is friction.total on a tier idea; its cost metric is metrics.tokensPerIdea",
      "use metrics.tokensPerIdea",
    ],
    [
      10,
      "frontmatter hypothesis-direction is up on a tier idea, which saves cost",
      "use down",
    ],
  ]);
});

test("a tier change beyond model and effort is rejected, because only a frontmatter edit is reversible", () => {
  tierProblems(FILE, keys({ "tier-change": "model, tools" }), METRICS);
  expect(messages()).toEqual([
    [
      11,
      "frontmatter tier-change names tools; a tier change edits only model or effort in an agent definition's frontmatter",
      "use model, effort or model, effort",
    ],
  ]);
});

test("a tier change on an idea that is not a harness idea is rejected", () => {
  tierProblems(FILE, keys({ kind: null }), METRICS);
  expect(messages()).toEqual([
    [
      10,
      "frontmatter tier-change needs kind: harness",
      "add kind: harness with the hypothesis fields, or remove the line",
    ],
  ]);
});

test("a guard metric with no tier change is rejected", () => {
  tierProblems(FILE, keys({ "tier-change": null }), METRICS);
  expect(messages()).toEqual([
    [
      11,
      "frontmatter guard-metric has no tier-change",
      "add tier-change: model or effort, or remove the line",
    ],
  ]);
});

test("a flow report that no longer names a tier metric is reported rather than trusted", () => {
  tierProblems(FILE, keys(), ["metrics.tokensPerIdea"]);
  expect(messages()).toEqual([
    [
      12,
      "frontmatter guard-metric rework.sendBacksPerIdea is not a flow report metric",
      "use one of metrics.tokensPerIdea (see `harness flow report --json`)",
    ],
  ]);
});
