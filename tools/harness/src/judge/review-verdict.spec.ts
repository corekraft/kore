import { describe, expect, it } from "vitest";
import {
  NAMED_HEAD,
  reviewBody,
  TRAILING_HEAD,
  VERDICT_LINE,
} from "./review-verdict.js";

const HEAD = "abc1234def5678abc1234def5678abc1234def56";

describe("the principles-review verdict body", () => {
  it("says no violations and names the head at eight characters on a clean review", () => {
    expect(reviewBody(HEAD, [])).toBe(
      "principles-review: No violations. (head abc1234d)",
    );
  });

  it("counts the findings and lists each one on its own line under the verdict", () => {
    expect(
      reviewBody(HEAD, ["a.ts:1 | rule | wrong", "b.ts:2 | rule | x"]),
    ).toBe(
      [
        "principles-review: 2 violations (head abc1234d)",
        "- a.ts:1 | rule | wrong",
        "- b.ts:2 | rule | x",
      ].join("\n"),
    );
  });

  it("never names the full commit sha, so the verdict stays short and matches live verdicts", () => {
    expect(reviewBody(HEAD, ["x"])).not.toContain(HEAD);
  });

  it("reads back, through the precheck's own parser, as the same verdict and head", () => {
    const clean = VERDICT_LINE.exec(reviewBody(HEAD, []))?.[1] ?? "";
    expect(clean.replace(TRAILING_HEAD, "").trim()).toBe("No violations.");
    expect(NAMED_HEAD.exec(reviewBody(HEAD, []))?.[1]).toBe("abc1234d");
  });

  it("keeps the verdict's own head when a finding also names a head", () => {
    const body = reviewBody(HEAD, ["fixed in head 9999999 earlier"]);
    expect(NAMED_HEAD.exec(body)?.[1]).toBe("abc1234d");
  });
});
