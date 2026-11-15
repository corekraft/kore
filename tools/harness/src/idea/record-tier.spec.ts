// A tier idea's record (#218): its tier block is rendered after the hypothesis block and read back with it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseIdea, renderIdea } from "./record.js";
import { readTier, renderTier, type Tier } from "./tier.js";

vi.mock("./tier.js");

const TIER: Tier = { fields: ["model"], guardMetric: "g" };
const HARNESS = {
  metric: "metrics.tokensPerIdea",
  direction: "down" as const,
  window: "14d",
};
const TEXT = [
  "---",
  "summary: s",
  "hypothesis: h",
  "expected-outcome: e",
  "measurement: m",
  "safety-pattern: no-behaviour-change",
  "date: 2026-03-04",
  "kind: harness",
  "hypothesis-metric: metrics.tokensPerIdea",
  "hypothesis-direction: down",
  "hypothesis-window: 14d",
  "---",
  "",
].join("\n");
const IDEA = {
  title: "t",
  summary: "s",
  hypothesis: "h",
  expectedOutcome: "e",
  measurement: "m",
  safetyPattern: "no-behaviour-change",
};

beforeEach(() => {
  vi.mocked(renderTier).mockImplementation((tier) =>
    tier === undefined ? [] : ["tier-change: model", "guard-metric: g"],
  );
  vi.mocked(readTier).mockReturnValue(undefined);
});

describe("a tier idea", () => {
  it("renders its tier lines directly after the hypothesis block", () => {
    const text = renderIdea("0001", "2026-03-04", {
      ...IDEA,
      harness: { ...HARNESS, tier: TIER },
    });
    expect(text).toContain(
      "hypothesis-window: 14d\ntier-change: model\nguard-metric: g\n",
    );
    expect(renderTier).toHaveBeenCalledWith(TIER);
  });

  it("renders no tier line for a harness idea without a tier", () => {
    const text = renderIdea("0001", "2026-03-04", {
      ...IDEA,
      harness: HARNESS,
    });
    expect(text).not.toContain("tier-change");
    expect(renderTier).toHaveBeenCalledWith(undefined);
  });

  it("is read back with its tier", () => {
    vi.mocked(readTier).mockReturnValue({ tier: TIER });
    expect(parseIdea("docs/ideas/0001-a.md", TEXT).harness).toEqual({
      ...HARNESS,
      tier: TIER,
    });
  });

  it("is read without a tier when it declares none", () => {
    expect(parseIdea("docs/ideas/0001-a.md", TEXT).harness).toEqual(HARNESS);
  });
});
