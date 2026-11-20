import { beforeEach, describe, expect, it, vi } from "vitest";
import { exclusionOf, type FrontierIssue } from "./exclusion.js";
import { buildFrontier, type FrontierInput } from "./frontier.js";

vi.mock("./exclusion.js");

const issue = (number: number): FrontierIssue => ({
  number,
  title: `Ticket ${number}`,
  body: "A plain ticket.",
  labels: ["ready-for-agent"],
  assignees: 0,
  openBlockers: 0,
  subIssues: 0,
  createdAt: "2026-01-03T00:00:00Z",
});

const input = (over: Partial<FrontierInput> = {}): FrontierInput => ({
  issues: [],
  ideas: [],
  openPrs: [],
  sendBacks: [],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exclusionOf).mockReturnValue(undefined);
});

describe("buildFrontier: a ticket whose PR has merged", () => {
  it("keeps the ticket in the queue, marked with the merged PR it waits on", () => {
    const frontier = buildFrontier(
      input({
        issues: [issue(20)],
        mergedPrs: new Map([[20, 1234]]),
      }),
    );

    expect(frontier.queue).toEqual([
      {
        kind: "ticket",
        issue: 20,
        since: "2026-01-03T00:00:00Z",
        lane: "product",
        horizon: "none",
        labels: ["ready-for-agent"],
        merged: 1234,
      },
    ]);
  });

  it("marks only the ticket the merged map names", () => {
    const frontier = buildFrontier(
      input({
        issues: [issue(20), issue(21)],
        mergedPrs: new Map([[20, 1234]]),
      }),
    );

    const byIssue = new Map(
      frontier.queue.map((item) => [
        item.kind === "send-back" ? item.pr : item.issue,
        item,
      ]),
    );
    expect(byIssue.get(20)).toHaveProperty("merged", 1234);
    expect(byIssue.get(21)).not.toHaveProperty("merged");
  });
});
