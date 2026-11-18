import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { buildReport, REPORT_VERSION } from "./report.js";

const HAIKU = "claude-haiku-5-5";
const MILLION = 1_000_000;
const ASOF = new Date("2026-11-19T00:00:00Z");

const at = (minute: number) =>
  new Date(Date.parse("2026-11-18T10:00:00Z") + minute * 60_000).toISOString();

const writerSplit = (minute: number, lowInput: number): LedgerEvent =>
  ({
    kind: "token.split",
    occurredAt: at(minute),
    agent: "idea-7-writer",
    idea: "7",
    model: HAIKU,
    lowInput,
  }) as LedgerEvent;

describe("flow report: token cost beside waiting time", () => {
  it("carries the per-agent, per-pull-request and per-idea figures, with the ceiling share from the config", () => {
    const events: LedgerEvent[] = [
      writerSplit(1, 3 * MILLION),
      {
        kind: "session.launch",
        occurredAt: at(0),
        agent: "idea-7-writer",
        idea: "7",
        role: "writer",
        tier: HAIKU,
      } as LedgerEvent,
    ];

    const report = buildReport(events, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      hostDays: 3,
      cost: { minMergedChanges: 1 },
      weeklyTokenCeiling: 30 * MILLION,
    });

    expect(report.version).toBe(38);
    expect(REPORT_VERSION).toBe(38);
    expect(report.costWaiting.agents.writer).toMatchObject({
      status: "measured",
      sessions: 1,
      tokens: { total: 3 * MILLION },
    });
    expect(report.costWaiting.ceilingShares.ceiling).toBe(30 * MILLION);
    expect(report.costWaiting.ceilingShares.agents.rows.writer).toEqual({
      label: "of the weekly ceiling",
      status: "measured",
      share: 0.1,
    });
    expect(report.costWaiting.ceilingShares.ideas.rows).toEqual([
      {
        idea: "7",
        share: {
          label: "of one week's ceiling",
          status: "measured",
          share: 0.1,
          spanSeconds: 60,
        },
      },
    ]);
    expect(report.costWaiting.ideas).toEqual([
      expect.objectContaining({ idea: "7", tokens: 3 * MILLION }),
    ]);
  });
});
