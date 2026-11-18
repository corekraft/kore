import { describe, expect, it } from "vitest";
import { HARNESS_CONFIG, parseHarnessConfig } from "./cost-config.js";
import { DEFAULT_COST, DEFAULT_MIN_MERGED_CHANGES } from "./cost.js";

const parse = (value: unknown) =>
  parseHarnessConfig(JSON.stringify(value), HARNESS_CONFIG);

describe("harness config compaction cap", () => {
  it("reads the cap as a whole number of at least 1, beside the other settings", () => {
    expect(parse({ compactionCap: 80000 })).toEqual({
      cost: DEFAULT_COST,
      compactionCap: 80000,
    });
    expect(parse({ compactionCap: 1 })).toEqual({
      cost: DEFAULT_COST,
      compactionCap: 1,
    });
  });

  it("leaves the cap out when it is not set, so no request is measured against one", () => {
    expect(parse({ ownerLogin: "junners" })).not.toHaveProperty(
      "compactionCap",
    );
  });

  it.each([0, -5, 80000.5, "80000", null])(
    "refuses a cap of %j with the key, what is wrong and the fix",
    (cap) => {
      expect(parse({ compactionCap: cap })).toEqual({
        error: `Invalid ${HARNESS_CONFIG}: key "compactionCap" must be a whole number of at least 1. Fix the value.`,
      });
    },
  );

  it("still refuses other unknown keys, and names the cap among the known ones", () => {
    expect(parse({ compactionLimit: 3 })).toEqual({
      error: expect.stringContaining(
        'key "compactionLimit" is not a harness config key',
      ),
    });
    expect(parse({ compactionLimit: 3 })).toEqual({
      error: expect.stringContaining("compactionCap"),
    });
  });
});

describe("harness config weekly token ceiling", () => {
  it("reads the ceiling as a whole number of plan-weighted tokens of at least 1, beside the other settings", () => {
    expect(parse({ weeklyTokenCeiling: 5000000 })).toEqual({
      cost: DEFAULT_COST,
      weeklyTokenCeiling: 5000000,
    });
    expect(parse({ weeklyTokenCeiling: 1 })).toEqual({
      cost: DEFAULT_COST,
      weeklyTokenCeiling: 1,
    });
  });

  it("leaves the ceiling out when it is not set, so a report reads it as not set and never as zero", () => {
    expect(parse({ ownerLogin: "junners" })).not.toHaveProperty(
      "weeklyTokenCeiling",
    );
    expect(parse({})).not.toHaveProperty("weeklyTokenCeiling");
  });

  it.each([0, -5, 5000000.5, "5000000", null])(
    "refuses a ceiling of %j with the key, what is wrong and the fix",
    (ceiling) => {
      expect(parse({ weeklyTokenCeiling: ceiling })).toEqual({
        error: `Invalid ${HARNESS_CONFIG}: key "weeklyTokenCeiling" must be a whole number of plan-weighted tokens of at least 1, or left out to read "not set". Fix the value.`,
      });
    },
  );

  it("still refuses a misspelt key, and names the ceiling among the known ones", () => {
    expect(parse({ weeklyTokenCeilin: 5000000 })).toEqual({
      error: expect.stringContaining(
        'key "weeklyTokenCeilin" is not a harness config key',
      ),
    });
    expect(parse({ weeklyTokenCeilin: 5000000 })).toEqual({
      error: expect.stringContaining("weeklyTokenCeiling"),
    });
  });
});

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
        minCategorisedSendBacks: DEFAULT_COST.minCategorisedSendBacks,
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

describe("harness config: the categorised send-back minimum (#1094)", () => {
  it("reads the fewest categorised send-backs a window needs before the share of other is read over or within", () => {
    expect(parse({ cost: { minCategorisedSendBacks: 30 } })).toEqual({
      cost: { ...DEFAULT_COST, minCategorisedSendBacks: 30 },
    });
  });

  it("uses the proposed minimum of 20 when the config leaves it out, since the merged-change minimum counts something else", () => {
    expect(parse({ cost: { trailingIdeas: 8 } })).toMatchObject({
      cost: { minCategorisedSendBacks: 20 },
    });
    expect(parse({})).toMatchObject({
      cost: { minCategorisedSendBacks: 20, minMergedChanges: 5 },
    });
  });

  it.each([0, -1, 2.5, "many", null, true])(
    "refuses a minimum of %j, naming the file, the key, what is wrong and the fix",
    (minimum) => {
      expect(parse({ cost: { minCategorisedSendBacks: minimum } })).toEqual({
        error: `Invalid ${HARNESS_CONFIG}: key "cost.minCategorisedSendBacks" must be a whole number of at least 1 (20 is proposed). Fix the value, or remove the key to use 20.`,
      });
    },
  );

  it("names the minimum among the known cost keys when a misspelt one is refused", () => {
    expect(parse({ cost: { minCategorisedSendBack: 20 } })).toEqual({
      error: expect.stringContaining("minCategorisedSendBacks"),
    });
  });
});
