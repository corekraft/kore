import { describe, expect, it } from "vitest";
import type { Frontier } from "../queue/index.js";
import { explanation, renderFrontier } from "./queue-frontier-view.js";

const WAITING: Frontier = {
  queue: [
    {
      kind: "ticket",
      issue: 20,
      since: "2026-01-07T00:00:00Z",
      lane: "product",
      horizon: "next",
      labels: ["ready-for-agent"],
    },
    {
      kind: "ticket",
      issue: 40,
      since: "2026-01-05T00:00:00Z",
      lane: "product",
      horizon: "next",
      labels: ["ready-for-agent"],
      merged: 1234,
    },
  ],
  excluded: [],
};

describe("renderFrontier with a ticket whose PR has merged", () => {
  it("prints the merged ticket as waiting on its PR, not as a numbered queue line", () => {
    expect(renderFrontier(WAITING, false)).toBe(
      [
        "1. ticket issue #20 lane product horizon next since 2026-01-07T00:00:00Z",
        "ticket issue #40 waiting: merged PR #1234",
        "",
      ].join("\n"),
    );
  });
});

describe("explanation with a ticket whose PR has merged", () => {
  it("says the ticket is waiting on its merged PR, and names the PR", () => {
    const answer = explanation(40, WAITING);

    expect(answer.text).toBe("issue #40 is waiting: merged PR #1234");
    expect(answer.json).toEqual({ issue: 40, status: "waiting", pr: 1234 });
  });

  it("counts only queued work when it places a queued ticket", () => {
    const answer = explanation(20, WAITING);

    expect(answer.json).toEqual({
      issue: 20,
      status: "queued",
      position: 1,
      item: WAITING.queue[0],
    });
    expect(answer.text).toContain("position 1 of 1");
  });
});
