import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { buildQueue } from "./queue.js";

vi.mock("./queue.js", () => ({
  ESCALATION_MODEL: "m",
  ESCALATION_THRESHOLD: 2,
  buildQueue: vi.fn(),
  countSendBacks: vi.fn(),
  writerTier: vi.fn(),
}));

describe("the queue barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "ESCALATION_MODEL",
      "ESCALATION_THRESHOLD",
      "FrontierError",
      "TICKET_QUEUE_FLAG",
      "buildFrontier",
      "buildQueue",
      "countSendBacks",
      "readReadyIssues",
      "ticketQueueOn",
      "writerTier",
    ]);
  });

  it("re-exports the unit's own function, not a copy", () => {
    expect(barrel.buildQueue).toBe(buildQueue);
  });
});
