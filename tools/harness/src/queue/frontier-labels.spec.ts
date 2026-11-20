import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontierIssue } from "./exclusion.js";
import { exclusionOf } from "./exclusion.js";
import { buildFrontier } from "./frontier.js";
import { pendingSendBacks } from "./queue.js";

vi.mock("./exclusion.js");
vi.mock("./queue.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queue.js")>()),
  pendingSendBacks: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exclusionOf).mockReturnValue(undefined);
  vi.mocked(pendingSendBacks).mockReturnValue([]);
});

describe("buildFrontier ticket labels", () => {
  it("carries every label of a queued ticket, so a live-proof label can be told apart", () => {
    const issue: FrontierIssue = {
      number: 60,
      title: "Ticket 60",
      body: "A plain ticket.",
      labels: ["ready-for-agent", "live-proof", "horizon:then"],
      assignees: 0,
      openBlockers: 0,
      subIssues: 0,
      createdAt: "2026-01-02T00:00:00Z",
    };
    const frontier = buildFrontier({
      issues: [issue],
      ideas: [],
      openPrs: [],
      sendBacks: [],
    });
    expect(frontier.queue).toEqual([
      {
        kind: "ticket",
        issue: 60,
        since: "2026-01-02T00:00:00Z",
        lane: "product",
        horizon: "then",
        labels: ["ready-for-agent", "live-proof", "horizon:then"],
      },
    ]);
  });
});
