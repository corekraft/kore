import { describe, expect, it } from "vitest";
import type { PrView } from "./checks.js";
import { hasSentBack, sendBackBody } from "./send-back.js";

function viewWith(bodies: string[], headSha = "abc1234"): PrView {
  return {
    baseSha: "",
    body: "",
    comments: bodies.map((body) => ({
      body,
      author: "bot",
      createdAt: "2026-01-02T00:00:00Z",
    })),
    headCommittedAt: undefined,
    headSha,
    rollup: [],
  };
}

describe("send-back body", () => {
  it("names the reason and the head commit it is about", () => {
    expect(sendBackBody("needs a test", "abc1234")).toBe(
      "Sent back by the judge: needs a test\n\nhead abc1234",
    );
  });
});

describe("send-back detection", () => {
  it("finds a send-back already posted for the current head", () => {
    const view = viewWith([sendBackBody("needs a test", "abc1234")]);
    expect(hasSentBack(view, "needs a test")).toBe(true);
  });

  it("posts nothing new when the reason was sent back for an older head", () => {
    const view = viewWith([sendBackBody("needs a test", "0ld0000")], "abc1234");
    expect(hasSentBack(view, "needs a test")).toBe(false);
  });

  it("does not match a different reason, or a comment that only mentions the reason", () => {
    const view = viewWith([
      sendBackBody("another reason", "abc1234"),
      "needs a test",
    ]);
    expect(hasSentBack(view, "needs a test")).toBe(false);
  });
});
