import { describe, expect, it } from "vitest";
import type { PrView } from "./checks.js";
import { hasSentBack, sendBackBody } from "./send-back.js";

const HEAD = "abc1234def5678abc1234def5678abc1234def56";

const view = (comments: PrView["comments"] = []): PrView => ({
  baseSha: "",
  body: "",
  comments,
  headCommittedAt: undefined,
  headSha: HEAD,
  rollup: [],
});

const comment = (body: string) => ({
  body,
  author: "junners",
  createdAt: "2026-11-14T10:00:00Z",
});

describe("sendBackBody", () => {
  it("writes the reason after the send-back prefix and names the head commit", () => {
    expect(sendBackBody("the diff is empty", HEAD)).toBe(
      `Sent back by the judge: the diff is empty\n\nhead ${HEAD}`,
    );
  });
});

describe("hasSentBack", () => {
  it("is true when the PR already carries this reason for its current head", () => {
    const body = sendBackBody("the diff is empty", HEAD);
    expect(hasSentBack(view([comment(body)]), "the diff is empty")).toBe(true);
  });

  it("is false when the PR has no comments, so a first send-back posts", () => {
    expect(hasSentBack(view(), "the diff is empty")).toBe(false);
  });

  it("is false for a send-back made against an older head, so the new head gets its own", () => {
    const older = sendBackBody("the diff is empty", "1111111");
    expect(hasSentBack(view([comment(older)]), "the diff is empty")).toBe(
      false,
    );
  });

  it("is false for a different reason on the same head", () => {
    const body = sendBackBody("the body has no declaration", HEAD);
    expect(hasSentBack(view([comment(body)]), "the diff is empty")).toBe(false);
  });
});
