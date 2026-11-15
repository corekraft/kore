// qualify's verdict for a model-tier idea (#218): reversible when the tier check finds nothing, left for a person otherwise.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostMetric } from "../flow/index.js";
import type { IdeaRecord } from "../idea/index.js";
import { qualify } from "./qualify.js";
import { tierRefusal } from "./qualify-tier.js";

vi.mock("./qualify-tier.js");

const ok = { status: "ok" } as unknown as CostMetric;
const input = {
  known: ["metrics.tokensPerIdea"],
  trailing: { "metrics.tokensPerIdea": ok },
};
const tier = { fields: ["model"], guardMetric: "rework.sendBacksPerIdea" };
const idea = {
  number: "0007",
  title: "Run the writer on a smaller model",
  summary: "Lower the writer's model tier.",
  expectedOutcome: "Fewer tokens per idea.",
  safetyPattern: "no-behaviour-change",
  harness: {
    metric: "metrics.tokensPerIdea",
    direction: "down",
    window: "14d",
    tier,
  },
} as IdeaRecord;

beforeEach(() => {
  vi.mocked(tierRefusal).mockReturnValue(undefined);
});

describe("qualify for a tier idea", () => {
  it("classes a frontmatter-only tier change as reversible and says what it is", () => {
    expect(qualify(idea, input)).toEqual({
      approve: true,
      reason:
        "Auto-approved: one revertible change (safety pattern no-behaviour-change, no data or external state migration, a frontmatter edit of model or effort measured on cost and judge send-backs together), and metrics.tokensPerIdea is in the flow report with a trailing average to measure against.",
    });
    expect(tierRefusal).toHaveBeenCalledWith(idea.harness, input);
  });

  it("leaves the idea for a person with the tier check's reason when it refuses", () => {
    vi.mocked(tierRefusal).mockReturnValue(
      "it declares a tier change touching tools.",
    );
    expect(qualify(idea, input)).toEqual({
      approve: false,
      reason: "Left for a person: it declares a tier change touching tools.",
    });
  });
});
