import { describe, expect, it } from "vitest";
import type { WriterArms } from "../flow/index.js";
import { writerArmLines } from "./flow-lines-writer-arms.js";

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

type Side = WriterArms["overall"]["haiku"];

/** An arm's side with nothing read, except the fields a test sets. */
const side = (tier: string, over: Partial<Side>): Side => ({
  tier,
  mergedChanges: 0,
  allInPerMergedChange: null,
  effort: {},
  blockedShare: null,
  sendBacksPerMergedChange: null,
  ownerMinutesPerMergedChange: null,
  ...over,
});

const READ: WriterArms = {
  seed: 20261117,
  resamples: 2000,
  confidence: 0.95,
  minMergedChanges: 2,
  unlabelled: 1,
  overall: {
    label: null,
    status: "ok",
    difference: -2.4667,
    interval: { low: -3, high: -1 },
    haiku: side(HAIKU, {
      mergedChanges: 2,
      allInPerMergedChange: 0.2,
      effort: { high: 2 },
      blockedShare: 0.5,
      sendBacksPerMergedChange: 0.5,
      ownerMinutesPerMergedChange: 0.5,
    }),
    sonnet: side(SONNET, {
      mergedChanges: 3,
      allInPerMergedChange: 2.6667,
      effort: { medium: 2, unknown: 1 },
      blockedShare: 0.3333,
      sendBacksPerMergedChange: 0.3333,
      ownerMinutesPerMergedChange: 1,
    }),
  },
  strata: [
    {
      label: "enhancement",
      status: "insufficient merged changes",
      needed: 2,
      haiku: side(HAIKU, { mergedChanges: 1 }),
      sonnet: side(SONNET, { mergedChanges: 1 }),
    },
    {
      label: "harness",
      status: "insufficient prices",
      models: ["claude-mystery-9"],
      haiku: side(HAIKU, { mergedChanges: 2 }),
      sonnet: side(SONNET, { mergedChanges: 2 }),
    },
  ],
};

describe("writer arms lines: the overall figure", () => {
  it("prints the difference, its interval and the seed, then each arm's counts, mean, effort and guards", () => {
    const [overall] = writerArmLines(READ);

    expect(overall).toBe(
      "Writer arms, all merged changes: Haiku minus Sonnet -$2.4667 all-in per merged change, 95% interval -$3 to -$1 (seed 20261117). Haiku: 2 merged changes, mean all-in $0.2, effort high 2, blocked share 0.5, send-backs per merged change 0.5, owner minutes per merged change 0.5. Sonnet: 3 merged changes, mean all-in $2.6667, effort medium 2, unknown 1, blocked share 0.3333, send-backs per merged change 0.3333, owner minutes per merged change 1.",
    );
  });

  it("names no winner, margin or better arm, and only states that the rule is the owner's", () => {
    const text = writerArmLines(READ).join("\n");

    expect(text).not.toMatch(/winner|margin|cheaper|wins|better/i);
  });

  it("reads a guard or a mean that cannot be read as not read, never as a zero", () => {
    const sparse: WriterArms = {
      ...READ,
      overall: {
        ...READ.overall,
        haiku: side(HAIKU, { mergedChanges: 2 }),
        sonnet: side(SONNET, { mergedChanges: 3 }),
      },
    } as WriterArms;
    const [overall] = writerArmLines(sparse);

    expect(overall).toContain(
      "Haiku: 2 merged changes, mean all-in not read, effort none, blocked share not read, send-backs per merged change not read, owner minutes per merged change not read.",
    );
  });
});

describe("writer arms lines: the strata", () => {
  it("prints a stratum below the minimum as insufficient, with each arm's count and the minimum, never a difference", () => {
    const lines = writerArmLines(READ);

    expect(lines[1]).toBe(
      "Writer arms, label enhancement: insufficient merged changes, Haiku 1 and Sonnet 1 (2 needed in each arm); not read.",
    );
  });

  it("prints a stratum whose change has no price as not read, naming the model", () => {
    const lines = writerArmLines(READ);

    expect(lines[2]).toBe(
      "Writer arms, label harness: not read, no price for claude-mystery-9.",
    );
  });

  it("prints one line per stratum after the overall figure, and a final line for the unlabelled changes", () => {
    const lines = writerArmLines(READ);

    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe(
      "Writer arms: 1 merged change on an arm with no label recorded, in the overall figure only. The report gives no verdict; the deciding rule is the owner's, recorded on the idea.",
    );
  });
});

describe("writer arms lines: an overall figure below the minimum", () => {
  it("says the overall figure is insufficient, with each arm's count", () => {
    const thin: WriterArms = {
      ...READ,
      overall: {
        label: null,
        status: "insufficient merged changes",
        needed: 2,
        haiku: side(HAIKU, { mergedChanges: 0 }),
        sonnet: side(SONNET, { mergedChanges: 3 }),
      },
      strata: [],
    };

    expect(writerArmLines(thin)[0]).toBe(
      "Writer arms, all merged changes: insufficient merged changes, Haiku 0 and Sonnet 3 (2 needed in each arm); not read.",
    );
  });
});
