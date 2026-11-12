import { describe, expect, it } from "vitest";
import { HARNESS_CONFIG, parseHarnessConfig } from "./cost-config.js";
import { DEFAULT_COST } from "./cost.js";

const parse = (value: unknown) =>
  parseHarnessConfig(JSON.stringify(value), HARNESS_CONFIG);

describe("harness config", () => {
  it("uses the defaults for an empty config", () => {
    expect(parse({})).toEqual({ cost: DEFAULT_COST });
  });

  it("reads the trailing window and per-metric thresholds", () => {
    expect(
      parse({
        cost: {
          trailingIdeas: 8,
          tokensPerIdea: { maxIncrease: 0.5 },
          sessionsPerIdea: { maxIncrease: 0 },
        },
      }),
    ).toEqual({
      cost: {
        trailingIdeas: 8,
        tokensPerIdea: { maxIncrease: 0.5 },
        sessionsPerIdea: { maxIncrease: 0 },
      },
    });
  });

  it.each([
    [
      { cost: { tokensPerIdea: { maxIncrease: -1 } } },
      "cost.tokensPerIdea.maxIncrease",
    ],
    [
      { cost: { sessionsPerIdea: { maxIncrease: "lots" } } },
      "cost.sessionsPerIdea.maxIncrease",
    ],
    [{ cost: { trailingIdeas: 0 } }, "cost.trailingIdeas"],
    [{ cost: { trailingIdeas: 2.5 } }, "cost.trailingIdeas"],
    [{ cost: { tokensPerIdea: 3 } }, "cost.tokensPerIdea"],
    [{ cost: { tokensPerIdea: { max: 1 } } }, "cost.tokensPerIdea.max"],
    [{ costs: {} }, "costs"],
    [[], "(root)"],
  ])("rejects %j naming the file, the key and the fix", (config, key) => {
    const result = parse(config);
    if (!("error" in result)) {
      throw new Error("expected the config to be rejected");
    }
    expect(result.error).toContain(HARNESS_CONFIG);
    expect(result.error).toContain(`"${key}"`);
    expect(result.error).toMatch(/Fix|Remove|Use/);
  });

  it("rejects text that is not JSON, naming the file", () => {
    const result = parseHarnessConfig("{oops", HARNESS_CONFIG);
    expect(result).toMatchObject({
      error: expect.stringContaining(HARNESS_CONFIG) as string,
    });
  });
});
