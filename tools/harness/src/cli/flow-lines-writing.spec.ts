import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { writingLines } from "./flow-lines-writing.js";

type Writing = FlowReport["costWaiting"]["writing"];

const WRITING: Writing = {
  attributed: { sessions: 1, tokens: 3_000_000, dollars: 7 },
  noIdea: { sessions: 1, tokens: 1_000_000, dollars: 1 },
  noPullRequest: { sessions: 1, tokens: 2_000_000, dollars: 6 },
  unjoinable: 4,
  share: { status: "measured", share: 0.5, sessions: 3 },
};

describe("writing lines: the share and the two named buckets", () => {
  it("prints the share, each bucket with its sessions, tokens and dollars, and the unjoinable count", () => {
    expect(writingLines(WRITING)).toEqual([
      "Writing attributed to an idea: 50% of writer tokens over 3 session(s)",
      "Writing in no idea (unattributed writer tokens): 1 session(s), 1000000 tokens, $1",
      "Writing in no pull request (unattributed writer tokens): 1 session(s), 2000000 tokens, $6",
      "Pull requests opened with no link to a writer (unjoinable): 4",
    ]);
  });

  it("prints a share below the minimum as not read, with the session count and the minimum, never a zero", () => {
    const lines = writingLines({
      ...WRITING,
      share: { status: "insufficient", sessions: 2, needed: 5 },
    });

    expect(lines[0]).toBe(
      "Writing attributed to an idea: not read, 2 session(s), 5 needed",
    );
  });

  it("prints a bucket with an unpriced model as insufficient prices naming it, with its tokens", () => {
    const lines = writingLines({
      ...WRITING,
      noIdea: {
        sessions: 1,
        tokens: 900,
        dollars: null,
        unpricedModels: ["zeta", "beta"],
      },
    });

    expect(lines[1]).toBe(
      "Writing in no idea (unattributed writer tokens): 1 session(s), 900 tokens, insufficient prices (zeta, beta)",
    );
  });
});
