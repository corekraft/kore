import { describe, expect, it } from "vitest";
import type { IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import {
  ESCALATION_MODEL,
  buildQueue,
  countSendBacks,
  writerTier,
} from "./queue.js";

const idea = (number: string, issue: string, outcome?: string): IdeaRecord => ({
  number,
  slug: `idea-${number}`,
  path: `docs/ideas/${number}-idea-${number}.md`,
  title: `Idea ${number}`,
  summary: "s",
  hypothesis: "h",
  expectedOutcome: "e",
  measurement: "m",
  safetyPattern: "dark-launched",
  date: "2026-01-01",
  issue,
  ...(outcome === undefined ? {} : { outcome }),
});

const sendBack = (
  number: number,
  occurredAt: string,
  head = "aaaaaaa",
): LedgerEvent => ({
  schema: 1,
  id: `${number}-${occurredAt}`,
  source: "github",
  kind: "send-back",
  occurredAt,
  recordedAt: occurredAt,
  number,
  label: `why @${head}`,
});

describe("countSendBacks", () => {
  it("counts only the send-backs of that PR", () => {
    const events = [
      sendBack(7, "2026-01-01T00:00:00.000Z"),
      sendBack(8, "2026-01-02T00:00:00.000Z"),
      sendBack(7, "2026-01-03T00:00:00.000Z", "bbbbbbb"),
    ];
    expect(countSendBacks(events, 7)).toBe(2);
    expect(countSendBacks(events, 8)).toBe(1);
    expect(countSendBacks(events, 9)).toBe(0);
  });

  it("ignores other event kinds on the same number", () => {
    const other = {
      ...sendBack(7, "2026-01-01T00:00:00.000Z"),
      kind: "precheck" as const,
    };
    expect(countSendBacks([other], 7)).toBe(0);
  });
});

describe("writerTier", () => {
  it("keeps the default model below two send-backs", () => {
    expect(writerTier(0, "claude-haiku-5-5")).toEqual({
      model: "claude-haiku-5-5",
      escalate: false,
    });
    expect(writerTier(1, "claude-haiku-5-5").model).toBe("claude-haiku-5-5");
  });

  it("selects Sonnet at two send-backs and beyond", () => {
    expect(writerTier(2, "claude-haiku-5-5")).toEqual({
      model: ESCALATION_MODEL,
      escalate: true,
    });
    expect(writerTier(5, "claude-haiku-5-5").escalate).toBe(true);
  });
});

const approved = new Map([
  [10, "2026-01-05T00:00:00.000Z"],
  [11, "2026-01-02T00:00:00.000Z"],
  [12, "2026-01-01T00:00:00.000Z"],
]);

describe("buildQueue ideas", () => {
  it("orders ideas and send-backs together, oldest first", () => {
    const queue = buildQueue({
      ideas: [idea("0001", "10"), idea("0002", "11")],
      approved,
      openPrs: [{ number: 50, head: "aaaaaaa1234" }],
      sendBacks: [sendBack(50, "2026-01-03T00:00:00.000Z")],
    });
    expect(queue.map((i) => [i.kind, i.since])).toEqual([
      ["idea", "2026-01-02T00:00:00.000Z"],
      ["send-back", "2026-01-03T00:00:00.000Z"],
      ["idea", "2026-01-05T00:00:00.000Z"],
    ]);
  });

  it("excludes an idea that already has an outcome", () => {
    const queue = buildQueue({
      ideas: [idea("0001", "10", "success"), idea("0002", "11")],
      approved,
      openPrs: [],
      sendBacks: [],
    });
    expect(queue.map((i) => (i.kind === "idea" ? i.idea : ""))).toEqual([
      "0002",
    ]);
  });

  it("excludes ideas whose issue is not approved, and issue links given as URLs match by number", () => {
    const queue = buildQueue({
      ideas: [
        idea("0001", "99"),
        idea("0002", "https://github.com/corekraft/kore/issues/12"),
      ],
      approved,
      openPrs: [],
      sendBacks: [],
    });
    expect(queue).toEqual([
      {
        kind: "idea",
        idea: "0002",
        issue: 12,
        since: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("buildQueue send-backs", () => {
  it("lists a send-back only while its PR is open and the head it names is still the head", () => {
    const queue = buildQueue({
      ideas: [],
      approved,
      openPrs: [
        { number: 50, head: "aaaaaaa1234" },
        { number: 51, head: "ccccccc9999" },
      ],
      sendBacks: [
        sendBack(50, "2026-01-03T00:00:00.000Z", "aaaaaaa"),
        sendBack(51, "2026-01-03T00:00:00.000Z", "bbbbbbb"),
        sendBack(52, "2026-01-03T00:00:00.000Z"),
      ],
    });
    expect(queue).toEqual([
      {
        kind: "send-back",
        pr: 50,
        count: 1,
        since: "2026-01-03T00:00:00.000Z",
      },
    ]);
  });

  it("reports the exact send-back count with the newest send-back deciding the head", () => {
    const queue = buildQueue({
      ideas: [],
      approved,
      openPrs: [{ number: 50, head: "bbbbbbb0000" }],
      sendBacks: [
        sendBack(50, "2026-01-01T00:00:00.000Z", "aaaaaaa"),
        sendBack(50, "2026-01-04T00:00:00.000Z", "bbbbbbb"),
      ],
    });
    expect(queue).toEqual([
      {
        kind: "send-back",
        pr: 50,
        count: 2,
        since: "2026-01-04T00:00:00.000Z",
      },
    ]);
  });
});
