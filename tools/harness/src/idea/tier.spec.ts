// A model-tier idea (#218): the frontmatter that says an agent's model or effort changes, and the second metric it is guarded by.
import { describe, expect, it } from "vitest";
import {
  TIER_COST_METRIC,
  TIER_GUARD_METRIC,
  attachTier,
  readTier,
  renderTier,
  tierFromFlags,
} from "./tier.js";
import { IdeaError } from "./record.js";

const getter = (keys: Record<string, string>) => (key: string) =>
  keys[key] ?? "";

describe("readTier", () => {
  it("reads the changed fields and the guard metric", () => {
    expect(
      readTier(
        getter({
          "tier-change": "model, effort",
          "guard-metric": TIER_GUARD_METRIC,
        }),
      ),
    ).toEqual({
      tier: { fields: ["model", "effort"], guardMetric: TIER_GUARD_METRIC },
    });
  });

  it("is absent for an idea that declares no tier change, even with a stray guard", () => {
    expect(
      readTier(getter({ "guard-metric": TIER_GUARD_METRIC })),
    ).toBeUndefined();
  });

  it("keeps a missing guard metric empty so a check can name what is missing", () => {
    expect(readTier(getter({ "tier-change": "model" }))?.tier.guardMetric).toBe(
      "",
    );
  });
});

describe("renderTier", () => {
  it("renders the change and its guard as frontmatter lines", () => {
    expect(
      renderTier({ fields: ["model"], guardMetric: TIER_GUARD_METRIC }),
    ).toEqual(["tier-change: model", `guard-metric: ${TIER_GUARD_METRIC}`]);
  });
});

describe("tierFromFlags", () => {
  it("is absent when no tier flag is given", () => {
    expect(tierFromFlags({})).toBeUndefined();
  });

  it("builds the tier from both flags", () => {
    expect(
      tierFromFlags({
        tierChange: "model,effort",
        guardMetric: TIER_GUARD_METRIC,
      }),
    ).toEqual({ fields: ["model", "effort"], guardMetric: TIER_GUARD_METRIC });
  });

  it("rejects a tier change that declares only cost, naming the missing guard metric", () => {
    expect(() => tierFromFlags({ tierChange: "model" })).toThrow(
      new IdeaError(
        `A tier idea is missing --guard-metric; pass --guard-metric ${TIER_GUARD_METRIC}, because a tier change is measured on cost and judge send-backs together.`,
      ),
    );
  });

  it("rejects a guard metric without a tier change", () => {
    expect(() => tierFromFlags({ guardMetric: TIER_GUARD_METRIC })).toThrow(
      new IdeaError(
        "--guard-metric needs --tier-change; add it, or leave the guard flag out.",
      ),
    );
  });

  it("rejects a field beyond model and effort", () => {
    expect(() =>
      tierFromFlags({
        tierChange: "model,tools",
        guardMetric: TIER_GUARD_METRIC,
      }),
    ).toThrow(
      new IdeaError(
        '--tier-change "model,tools" names tools; a tier change edits only model or effort in an agent definition\'s frontmatter.',
      ),
    );
  });

  it("rejects a guard metric that is not the send-backs metric", () => {
    expect(() =>
      tierFromFlags({ tierChange: "model", guardMetric: "friction.total" }),
    ).toThrow(
      new IdeaError(
        `--guard-metric "friction.total" is not the judge send-backs metric; use ${TIER_GUARD_METRIC}.`,
      ),
    );
  });
});

describe("attachTier", () => {
  const tier = { fields: ["model"], guardMetric: TIER_GUARD_METRIC };
  const cost = {
    metric: TIER_COST_METRIC,
    direction: "down" as const,
    window: "14d",
  };

  it("leaves a harness idea with no tier as it is", () => {
    expect(attachTier(cost, undefined)).toBe(cost);
    expect(attachTier(undefined, undefined)).toBeUndefined();
  });

  it("puts the tier on a hypothesis that measures tokens per idea", () => {
    expect(attachTier(cost, tier)).toEqual({ ...cost, tier });
  });

  it("refuses a tier on an idea that is not a harness idea", () => {
    expect(() => attachTier(undefined, tier)).toThrow(
      new IdeaError(
        "--tier-change needs --kind harness; add it with the cost hypothesis.",
      ),
    );
  });

  it("refuses a tier idea whose hypothesis metric is not cost", () => {
    expect(() =>
      attachTier({ ...cost, metric: "friction.total" }, tier),
    ).toThrow(
      new IdeaError(
        `A tier idea's hypothesis metric is ${TIER_COST_METRIC} (tokens per idea), not friction.total; pass --metric ${TIER_COST_METRIC} --direction down.`,
      ),
    );
  });

  it("refuses a tier idea that does not expect cost to fall", () => {
    expect(() => attachTier({ ...cost, direction: "up" }, tier)).toThrow(
      new IdeaError(
        `A tier idea expects ${TIER_COST_METRIC} to fall; pass --direction down.`,
      ),
    );
  });
});
