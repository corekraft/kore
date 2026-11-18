import { describe, expect, it, vi } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { costWaitingLines } from "./flow-lines-cost-waiting.js";
import { shareLines } from "./flow-lines-shares.js";

// The shares of the ceiling have their own lines and spec; here they are one fake line.
vi.mock("./flow-lines-shares.js", () => ({ shareLines: vi.fn(() => []) }));

type Cost = FlowReport["costWaiting"];

const measuredWriter = {
  status: "measured" as const,
  sessions: 1,
  dollars: { total: 7, median: 7, p90: 7 },
  tokens: { total: 3000000, median: 3000000, p90: 3000000 },
  activeSeconds: { total: 1200, median: 1200, p90: 1200 },
  waitingSeconds: { total: 600, median: 600, p90: 600 },
};

const EMPTY: Cost = {
  agents: {} as Cost["agents"],
  ceilingShares: {} as Cost["ceilingShares"],
  ideas: [],
  mergedChanges: {
    changes: [],
    status: "insufficient",
    joined: 0,
    needed: 5,
  },
  writing: {
    attributed: { sessions: 0, tokens: 0, dollars: 0 },
    noIdea: { sessions: 0, tokens: 0, dollars: 0 },
    noPullRequest: { sessions: 0, tokens: 0, dollars: 0 },
    unjoinable: 0,
    share: { status: "insufficient", sessions: 0, needed: 5 },
  },
};

describe("cost beside waiting lines: the headline and its rows", () => {
  it("prints a measured role with its dollars, tokens and seconds, and no share of its own", () => {
    const cost = {
      ...EMPTY,
      agents: { writer: measuredWriter } as unknown as Cost["agents"],
    };

    expect(costWaitingLines(cost)[1]).toBe(
      "  writer: 1 session(s); dollars $7 (median $7, p90 $7); tokens 3000000 (median 3000000, p90 3000000); active median 1200s, p90 1200s; waiting median 600s, p90 600s",
    );
  });

  it("says a role below the minimum is not read, with its count and the minimum needed", () => {
    const cost = {
      ...EMPTY,
      agents: {
        judge: { status: "insufficient", sessions: 2, needed: 5 },
      } as unknown as Cost["agents"],
    };

    expect(costWaitingLines(cost)[1]).toBe(
      "  judge not read: 2 session(s), 5 needed",
    );
  });

  it("names the models a role could not price, never printing a zero", () => {
    const cost = {
      ...EMPTY,
      agents: {
        reader: { status: "insufficient prices", models: ["x-model"] },
      } as unknown as Cost["agents"],
    };

    expect(costWaitingLines(cost)[1]).toBe(
      "  reader not read: no price for x-model",
    );
  });

  it("prints the shares of the weekly ceiling last, after the ideas", () => {
    vi.mocked(shareLines).mockReturnValueOnce(["Shares line", "  a row"]);

    expect(costWaitingLines(EMPTY).slice(-2)).toEqual([
      "  Shares line",
      "    a row",
    ]);
    expect(shareLines).toHaveBeenLastCalledWith(EMPTY.ceilingShares);
  });

  it("prints the merged-change level as not read until its joined count reaches the minimum", () => {
    expect(costWaitingLines(EMPTY).slice(0, 2)).toEqual([
      "Token cost beside waiting time (#1019):",
      "  Merged changes: not read, 0 joined (5 needed)",
    ]);
  });

  it("prints an idea with its dollars, tokens, outcome and lead time", () => {
    const cost: Cost = {
      ...EMPTY,
      ideas: [
        {
          idea: "7",
          dollars: 8,
          tokens: 4000000,
          leadTimeSeconds: 3600,
          outcome: "closed",
        },
      ],
    };

    expect(costWaitingLines(cost).at(-1)).toBe(
      "  Idea 7: $8, 4000000 tokens, closed, lead 3600s",
    );
  });
});

describe("cost beside waiting lines: an unpriced model", () => {
  it("prints the merged-change level as insufficient prices naming the models", () => {
    const cost: Cost = {
      ...EMPTY,
      mergedChanges: {
        changes: [],
        status: "insufficient prices",
        joined: 3,
        needed: 5,
        models: ["a", "b"],
      },
    };

    expect(costWaitingLines(cost).slice(0, 2)).toEqual([
      "Token cost beside waiting time (#1019):",
      "  Merged changes: insufficient prices (a, b)",
    ]);
  });

  it("prints an idea with unpriced dollars as insufficient prices naming the models, with its tokens", () => {
    const cost: Cost = {
      ...EMPTY,
      ideas: [
        {
          idea: "7",
          dollars: null,
          unpricedModels: ["zeta"],
          tokens: 900,
          leadTimeSeconds: null,
          outcome: null,
        },
      ],
    };

    expect(costWaitingLines(cost).at(-1)).toBe(
      "  Idea 7: insufficient prices (zeta), 900 tokens, open",
    );
  });
});

describe("cost beside waiting lines: the writing lines (#1093)", () => {
  it("prints the writing lines after the merged changes and before the ideas", () => {
    const cost: Cost = {
      ...EMPTY,
      ideas: [
        {
          idea: "7",
          dollars: 8,
          tokens: 4000000,
          leadTimeSeconds: null,
          outcome: null,
        },
      ],
    };

    expect(costWaitingLines(cost).slice(2)).toEqual([
      "  Writing attributed to an idea: not read, 0 session(s), 5 needed",
      "  Writing in no idea (unattributed writer tokens): 0 session(s), 0 tokens, $0",
      "  Writing in no pull request (unattributed writer tokens): 0 session(s), 0 tokens, $0",
      "  Pull requests opened with no link to a writer (unjoinable): 0",
      "  Idea 7: $8, 4000000 tokens, open",
    ]);
  });
});
