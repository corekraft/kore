import { describe, expect, it } from "vitest";
import type { Frontier } from "../queue/index.js";
import { QueueError } from "./queue-error.js";
import {
  explainedIssue,
  explanation,
  renderFrontier,
} from "./queue-frontier-view.js";

const FRONTIER: Frontier = {
  queue: [
    { kind: "send-back", pr: 50, count: 1, since: "2026-01-06T00:00:00Z" },
    {
      kind: "idea",
      idea: "0001",
      issue: 10,
      since: "2026-01-05T00:00:00Z",
      lane: "product",
      horizon: "next",
    },
    {
      kind: "ticket",
      issue: 20,
      since: "2026-01-07T00:00:00Z",
      lane: "harness",
      horizon: "none",
      labels: ["ready-for-agent", "harness"],
    },
  ],
  excluded: [{ issue: 30, reason: "assigned" }],
};

describe("renderFrontier", () => {
  it("prints one numbered line per item in queue order, with kind, lane and horizon", () => {
    expect(renderFrontier(FRONTIER, false)).toBe(
      [
        "1. send-back PR #50 lane - horizon - since 2026-01-06T00:00:00Z",
        "2. idea 0001 (issue #10) lane product horizon next since 2026-01-05T00:00:00Z",
        "3. ticket issue #20 lane harness horizon none since 2026-01-07T00:00:00Z",
        "",
      ].join("\n"),
    );
  });

  it("says the queue is empty when nothing is queued, even if issues were excluded", () => {
    expect(
      renderFrontier({ queue: [], excluded: FRONTIER.excluded }, false),
    ).toBe("The queue is empty.\n");
  });

  it("prints the queue and the excluded list as JSON, and does not number anything", () => {
    expect(renderFrontier(FRONTIER, true)).toBe(
      `${JSON.stringify({ queue: FRONTIER.queue, excluded: FRONTIER.excluded })}\n`,
    );
  });
});

describe("explainedIssue", () => {
  it("reads no operand as no explanation", () => {
    expect(explainedIssue(undefined)).toBeUndefined();
  });

  it("reads a positive issue number", () => {
    expect(explainedIssue("1419")).toBe(1419);
  });

  it.each(["0", "abc", "-3", "1.5", "true"])(
    "refuses %s, naming the command to run",
    (raw) => {
      expect(() => explainedIssue(raw)).toThrow(
        new QueueError(
          "Missing or invalid issue number. Run `harness queue next --explain <issue>`.",
        ),
      );
    },
  );

  it("refuses a flag given with no value", () => {
    expect(() => explainedIssue(true)).toThrow(QueueError);
  });
});

describe("explanation", () => {
  it("places a queued issue at its position, skipping send-backs in the count", () => {
    expect(explanation(20, FRONTIER)).toEqual({
      json: {
        issue: 20,
        status: "queued",
        position: 3,
        item: FRONTIER.queue[2],
      },
      text: "issue #20 is queued at position 3 of 3: ticket, lane harness, horizon none",
    });
  });

  it("names the reason an excluded issue is not queued, in words", () => {
    expect(explanation(30, FRONTIER)).toEqual({
      json: { issue: 30, status: "excluded", reason: "assigned" },
      text: "issue #30 is excluded: it has an assignee",
    });
  });

  it("says an issue the search did not return lacks ready-for-agent or is not open", () => {
    expect(explanation(99, FRONTIER)).toEqual({
      json: { issue: 99, status: "absent" },
      text: "issue #99 is not queued: it lacks the ready-for-agent label, or is not open",
    });
  });

  it("never reports a send-back as the place of an issue with the same number", () => {
    expect(explanation(50, FRONTIER).json).toEqual({
      issue: 50,
      status: "absent",
    });
  });
});
