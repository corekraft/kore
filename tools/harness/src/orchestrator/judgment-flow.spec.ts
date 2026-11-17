import { describe, expect, it } from "vitest";
import {
  decide,
  READ_ROUNDS,
  RETRIES,
  type DecisionState,
} from "./judgment-flow.js";

const fresh: DecisionState = { readRounds: 0, refusals: 0 };
const refused = {
  ok: false as const,
  error: "Plan work item 2 has field role: use writer or reader.",
};
const reads = {
  ok: true as const,
  plan: {
    kind: "reads" as const,
    reads: [
      {
        question: "Which file holds the cap?",
        paths: ["tools/harness/src/a.ts"],
      },
    ],
  },
};
const work = {
  ok: true as const,
  plan: {
    kind: "work" as const,
    work: [
      {
        role: "writer" as const,
        name: "split-a",
        brief: "Write the first half",
        files: ["tools/harness/src/a.ts"],
        after: [],
      },
    ],
  },
};

describe("decide: refused plans", () => {
  it("retries a refused plan once, with the refusal's own message", () => {
    expect(decide(fresh, refused)).toEqual({
      step: "retry",
      reason: "Plan work item 2 has field role: use writer or reader.",
    });
  });

  it("labels the idea needs-info when the retry is refused too", () => {
    expect(decide({ readRounds: 0, refusals: RETRIES }, refused)).toEqual({
      step: "needs-info",
      reason: "Plan work item 2 has field role: use writer or reader.",
    });
  });

  it("allows exactly one retry", () => {
    expect(RETRIES).toBe(1);
  });
});

describe("decide: stop and work", () => {
  it("takes a stop straight to needs-info, without a retry", () => {
    expect(
      decide(fresh, {
        ok: true,
        plan: { kind: "stop", reason: "Needs the owner" },
      }),
    ).toEqual({ step: "needs-info", reason: "Needs the owner" });
  });

  it("hands a work plan to the tick, which spawns the pieces itself", () => {
    expect(decide(fresh, work)).toEqual({ step: "work", work: work.plan.work });
  });
});

describe("decide: bounded reads", () => {
  it("sends a reads plan to readers in the first read round", () => {
    expect(decide(fresh, reads)).toEqual({
      step: "read",
      reads: reads.plan.reads,
    });
  });

  it("sends a reads plan to readers in the second read round", () => {
    expect(decide({ readRounds: 1, refusals: 0 }, reads)).toEqual({
      step: "read",
      reads: reads.plan.reads,
    });
  });

  it("uses two read rounds, the ticket's two passes", () => {
    expect(READ_ROUNDS).toBe(2);
  });

  it("refuses a reads plan after the last round and names the limit", () => {
    expect(decide({ readRounds: READ_ROUNDS, refusals: 0 }, reads)).toEqual({
      step: "retry",
      reason: `The plan asks for reads after ${READ_ROUNDS} read rounds, the most one decision may take; it must now be work or stop. Nothing was started.`,
    });
  });

  it("labels needs-info when a reads plan past the last round is refused again", () => {
    expect(
      decide({ readRounds: READ_ROUNDS, refusals: RETRIES }, reads),
    ).toEqual({
      step: "needs-info",
      reason: `The plan asks for reads after ${READ_ROUNDS} read rounds, the most one decision may take; it must now be work or stop. Nothing was started.`,
    });
  });
});
