import { describe, expect, it } from "vitest";
import { HARNESS_CONFIG, parseHarnessConfig } from "./cost-config.js";
import { DEFAULT_COST, DEFAULT_MIN_MERGED_CHANGES } from "./cost.js";

const parse = (value: unknown) =>
  parseHarnessConfig(JSON.stringify(value), HARNESS_CONFIG);

describe("harness config retro history minimums", () => {
  it("reads the days and sessions the retro scan needs, each on its own", () => {
    expect(parse({ retro: { minDays: 7, minSessions: 50 } })).toEqual({
      cost: DEFAULT_COST,
      retro: { minDays: 7, minSessions: 50 },
    });
    expect(parse({ retro: { minSessions: 250 } })).toEqual({
      cost: DEFAULT_COST,
      retro: { minSessions: 250 },
    });
  });

  it("leaves the retro key out when it is not set, so the scan keeps its defaults", () => {
    expect(parse({ ownerLogin: "junners" })).not.toHaveProperty("retro");
  });

  it.each([
    [
      { retro: { minDays: 0 } },
      "retro.minDays",
      "a whole number of at least 1",
    ],
    [{ retro: { minSessions: 2.5 } }, "retro.minSessions", "a whole number"],
    [{ retro: { minDays: "two" } }, "retro.minDays", "a whole number"],
    [{ retro: { days: 3 } }, "retro.days", "minDays, minSessions"],
    [{ retro: 14 }, "retro", "must be an object"],
  ])("rejects %j naming the key and the fix", (config, key, fix) => {
    expect(parse(config)).toEqual({
      error: expect.stringContaining(`key "${key}"`),
    });
    expect(parse(config)).toEqual({
      error: expect.stringContaining(fix),
    });
  });
});

describe("harness config", () => {
  it("uses the defaults for an empty config", () => {
    expect(parse({})).toEqual({ cost: DEFAULT_COST });
  });

  it("reads the owner login the owner-minutes metric counts", () => {
    expect(parse({ ownerLogin: "junners" })).toEqual({
      cost: DEFAULT_COST,
      ownerLogin: "junners",
    });
  });

  it("refuses an owner login that is not a GitHub login", () => {
    expect(parse({ ownerLogin: "two words" })).toEqual({
      error: expect.stringContaining('key "ownerLogin"'),
    });
    expect(parse({ ownerLogin: 7 })).toHaveProperty("error");
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
        minMergedChanges: DEFAULT_COST.minMergedChanges,
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

describe("harness config reviewer logins", () => {
  it("reads the reviewer logins the judge trusts for principles-review verdicts", () => {
    expect(parse({ reviewerLogins: ["bot-a", "junners"] })).toEqual({
      cost: DEFAULT_COST,
      reviewerLogins: ["bot-a", "junners"],
    });
  });

  it("trusts a GitHub App's reviewer login, written app/<slug> as gh reports it", () => {
    expect(parse({ reviewerLogins: ["junners", "app/kore-reviewer"] })).toEqual(
      {
        cost: DEFAULT_COST,
        reviewerLogins: ["junners", "app/kore-reviewer"],
      },
    );
  });

  it("does not let an App form into the owner login, which stays a plain login", () => {
    expect(parse({ ownerLogin: "app/kore-reviewer" })).toEqual({
      error: expect.stringContaining('key "ownerLogin"'),
    });
  });

  it.each([
    [{ reviewerLogins: [] }],
    [{ reviewerLogins: "junners" }],
    [{ reviewerLogins: ["two words"] }],
    [{ reviewerLogins: [7] }],
    [{ reviewerLogins: ["app/"] }],
    [{ reviewerLogins: ["app/kore-reviewer/extra"] }],
    [{ reviewerLogins: ["app/-kore"] }],
    [{ reviewerLogins: ["apps/kore-reviewer"] }],
  ])("refuses reviewer logins %j, naming the key and the fix", (config) => {
    expect(parse(config)).toEqual({
      error: expect.stringContaining('key "reviewerLogins"'),
    });
  });
});

describe("harness config: the merged-change minimum", () => {
  it("reads the fewest merged changes a window needs before its per-merged figure is read", () => {
    expect(parse({ cost: { minMergedChanges: 9 } })).toEqual({
      cost: { ...DEFAULT_COST, minMergedChanges: 9 },
    });
  });

  it("uses the placeholder minimum merged changes when the config leaves it out", () => {
    expect(parse({ cost: { trailingIdeas: 8 } })).toMatchObject({
      cost: { minMergedChanges: DEFAULT_MIN_MERGED_CHANGES },
    });
  });

  it.each([
    [{ cost: { minMergedChanges: 0 } }],
    [{ cost: { minMergedChanges: 2.5 } }],
    [{ cost: { minMergedChanges: "many" } }],
  ])("rejects %j, naming the key and the fix", (config) => {
    expect(parse(config)).toEqual({
      error: expect.stringContaining('key "cost.minMergedChanges"'),
    });
  });
});
