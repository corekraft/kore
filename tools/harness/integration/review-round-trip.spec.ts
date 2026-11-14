// The verdict `harness review post` writes must read back through the precheck's own
// review check as the verdict and head it was formatted with. Integration tier: the
// formatter and the precheck run together, with no gh and no cluster (ADR 0098).

import { describe, expect, it } from "vitest";
import { reviewBody, reviewCheck, type PrView } from "../src/judge/index.js";

const HEAD = "abc1234def5678abc1234def5678abc1234def56";
const OLD_HEAD = "0000000000000000000000000000000000000000";
const REVIEWER = "reviewer-bot";

const viewWith = (body: string, headSha = HEAD): PrView => ({
  baseSha: "",
  body: "",
  comments: [{ body, author: REVIEWER, createdAt: "2026-11-14T10:00:00Z" }],
  headCommittedAt: "2026-11-14T09:00:00Z",
  headSha,
  rollup: [],
});

describe("a posted principles-review verdict reads back through the precheck", () => {
  it("passes for a clean review on the head it names", () => {
    expect(reviewCheck(viewWith(reviewBody(HEAD, [])), [REVIEWER])).toEqual({
      result: "pass",
    });
  });

  it("fails with the verdict as its detail when findings were posted", () => {
    expect(
      reviewCheck(viewWith(reviewBody(HEAD, ["a.ts:1 | rule | wrong", "b"])), [
        REVIEWER,
      ]),
    ).toEqual({ result: "fail", detail: "2 violations" });
  });

  it("is not trusted for a head it does not name, so a later push makes it stale", () => {
    expect(
      reviewCheck(viewWith(reviewBody(OLD_HEAD, [])), [REVIEWER]).result,
    ).toBe("unverified");
  });
});
