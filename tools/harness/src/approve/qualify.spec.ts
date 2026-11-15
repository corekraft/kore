import { describe, expect, it } from "vitest";
import type { CostMetric } from "../flow/index.js";
import type { IdeaRecord } from "../idea/index.js";
import { qualify } from "./qualify.js";

const ok = {
  status: "ok",
  currentIdea: "#9",
  current: 4,
  trailingAverage: 5,
  worsened: false,
} as unknown as CostMetric;

const known = ["metrics.tokensPerIdea", "leadTime.medianSeconds"];
const trailing = { "metrics.tokensPerIdea": ok };

function idea(over: Partial<IdeaRecord> = {}): IdeaRecord {
  return {
    number: "0007",
    slug: "cache-probes",
    path: "docs/ideas/0007-cache-probes.md",
    title: "Cache probe results",
    summary: "Cache probe results between runs.",
    hypothesis: "Caching cuts tokens.",
    expectedOutcome: "Fewer tokens per idea.",
    measurement: "tokensPerIdea",
    safetyPattern: "no-behaviour-change",
    date: "2026-11-14",
    issue: "215",
    harness: {
      metric: "metrics.tokensPerIdea",
      direction: "down",
      window: "14d",
    },
    ...over,
  };
}

describe("qualify", () => {
  it("approves a reversible idea whose metric has a trailing average, and says why", () => {
    expect(qualify(idea(), { known, trailing })).toEqual({
      approve: true,
      reason:
        "Auto-approved: one revertible change (safety pattern no-behaviour-change, no data or external state migration), and metrics.tokensPerIdea is in the flow report with a trailing average to measure against.",
    });
  });

  it("refuses an idea that is not a harness idea", () => {
    const { harness: _unused, ...plain } = idea();
    expect(qualify(plain, { known, trailing })).toEqual({
      approve: false,
      reason:
        "Left for a person: this is not a harness idea (no kind: harness hypothesis of metric, direction and window).",
    });
  });

  it("refuses expand-contract, which migrates data, as irreversible", () => {
    const verdict = qualify(idea({ safetyPattern: "expand-contract" }), {
      known,
      trailing,
    });
    expect(verdict).toEqual({
      approve: false,
      reason:
        "Left for a person: safety pattern expand-contract is not one revertible change; it migrates data or external state. Only no-behaviour-change, feature-flagged, dark-launched and branch-by-abstraction count as reversible.",
    });
  });

  it.each([
    ["title", { title: "Enforce the secret-path guardrail" }],
    ["summary", { summary: "Move the destructive guardrail to enforce." }],
    ["expected outcome", { expectedOutcome: "The guardrail enforces." }],
  ])("refuses an idea whose %s moves a guardrail to enforce", (_n, over) => {
    expect(qualify(idea(over), { known, trailing })).toEqual({
      approve: false,
      reason:
        "Left for a person: it moves a guardrail to enforce, and enforcement needs a person's decision (audit before enforce).",
    });
  });
});

describe("qualify metric checks", () => {
  it("refuses a metric the flow report does not have", () => {
    const verdict = qualify(
      idea({
        harness: { metric: "metrics.nope", direction: "up", window: "7d" },
      }),
      { known, trailing },
    );
    expect(verdict).toEqual({
      approve: false,
      reason:
        "Left for a person: metrics.nope is not a metric of the flow report (see `harness flow report --json`).",
    });
  });

  it("refuses a report metric that has no trailing average", () => {
    const verdict = qualify(
      idea({
        harness: {
          metric: "leadTime.medianSeconds",
          direction: "down",
          window: "7d",
        },
      }),
      { known, trailing },
    );
    expect(verdict).toEqual({
      approve: false,
      reason:
        "Left for a person: leadTime.medianSeconds is in the flow report but has no trailing average to compare against.",
    });
  });

  it("refuses a metric with too little history, naming the shortfall", () => {
    const verdict = qualify(idea(), {
      known,
      trailing: {
        "metrics.tokensPerIdea": {
          status: "insufficient history",
          closedIdeas: 2,
          needed: 5,
        } as CostMetric,
      },
    });
    expect(verdict).toEqual({
      approve: false,
      reason:
        "Left for a person: metrics.tokensPerIdea has too little history for a trailing average (2 closed ideas, 5 needed).",
    });
  });
});
