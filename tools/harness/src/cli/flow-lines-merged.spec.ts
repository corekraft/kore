import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import {
  leadTimePerMergedChangeLine,
  perMergedChangeLines,
  sendBacksPerMergedChangeLine,
} from "./flow-lines.js";

describe("perMergedChangeLines: the three per-merged-change lines in report order (#829, #830)", () => {
  it("prints tokens, then send-backs, then lead time, each per merged change", () => {
    const tokens: FlowReport["tokensPerMergedChange"] = {
      trailingDays: 7,
      minMergedChanges: 5,
      current: { status: "ok", tokens: 350, merged: 2, perMerged: 175 },
      trailingAverage: { status: "ok", tokens: 600, merged: 5, perMerged: 120 },
    };
    const sendBacks: FlowReport["sendBacksPerMergedChange"] = {
      trailingDays: 7,
      minMergedChanges: 5,
      current: { status: "ok", sendBacks: 2, merged: 2, perMerged: 1 },
      trailingAverage: {
        status: "ok",
        sendBacks: 4,
        merged: 5,
        perMerged: 0.8,
      },
    };
    const leadTime: FlowReport["leadTimePerMergedChange"] = {
      trailingDays: 7,
      minMergedChanges: 5,
      current: { status: "ok", merged: 3, measured: 3, medianSeconds: 1200 },
      trailingAverage: {
        status: "ok",
        merged: 5,
        measured: 5,
        medianSeconds: 900,
      },
    };

    expect(
      perMergedChangeLines({
        tokensPerMergedChange: tokens,
        sendBacksPerMergedChange: sendBacks,
        leadTimePerMergedChange: leadTime,
      }),
    ).toEqual([
      "Tokens per merged change: 175 (350 tokens over 2 merged changes); average 120 over the trailing 7 days",
      "Send-backs per merged change: 1 (2 send-backs over 2 merged changes); average 0.8 over the trailing 7 days",
      "Lead time per merged change: 1200s median (3 of 3 merged changes measured); average 900s over the trailing 7 days",
    ]);
  });
});

describe("sendBacksPerMergedChangeLine (#830)", () => {
  const TRAILING = { trailingDays: 7, minMergedChanges: 5 };
  const of = (
    current: FlowReport["sendBacksPerMergedChange"]["current"],
    trailingAverage: FlowReport["sendBacksPerMergedChange"]["trailingAverage"],
  ) => sendBacksPerMergedChangeLine({ ...TRAILING, current, trailingAverage });

  it("reads the window's send-backs per merged change against the trailing average", () => {
    expect(
      of(
        { status: "ok", sendBacks: 2, merged: 2, perMerged: 1 },
        { status: "ok", sendBacks: 4, merged: 5, perMerged: 0.8 },
      ),
    ).toBe(
      "Send-backs per merged change: 1 (2 send-backs over 2 merged changes); average 0.8 over the trailing 7 days",
    );
  });

  it("says the window's figure is not read, never a zero, below the minimum", () => {
    expect(
      of(
        { status: "insufficient merged changes", merged: 1, needed: 5 },
        { status: "ok", sendBacks: 4, merged: 5, perMerged: 0.8 },
      ),
    ).toBe(
      "Send-backs per merged change: not read, 1 merged change in this range (5 needed); average 0.8 over the trailing 7 days",
    );
  });

  it("says there is no average when the trailing days have too few merged changes", () => {
    expect(
      of(
        { status: "ok", sendBacks: 0, merged: 5, perMerged: 0 },
        { status: "insufficient merged changes", merged: 0, needed: 5 },
      ),
    ).toBe(
      "Send-backs per merged change: 0 (0 send-backs over 5 merged changes); no average: 0 merged changes in the trailing 7 days (5 needed)",
    );
  });
});

describe("leadTimePerMergedChangeLine (#830)", () => {
  const TRAILING = { trailingDays: 7, minMergedChanges: 5 };
  const of = (
    current: FlowReport["leadTimePerMergedChange"]["current"],
    trailingAverage: FlowReport["leadTimePerMergedChange"]["trailingAverage"],
  ) => leadTimePerMergedChangeLine({ ...TRAILING, current, trailingAverage });

  it("reads the window's median lead time against the trailing average, with how many were measured", () => {
    expect(
      of(
        { status: "ok", merged: 3, measured: 3, medianSeconds: 1200 },
        { status: "ok", merged: 5, measured: 4, medianSeconds: 900 },
      ),
    ).toBe(
      "Lead time per merged change: 1200s median (3 of 3 merged changes measured); average 900s over the trailing 7 days",
    );
  });

  it("says the window's median is not read, never a zero, below the minimum", () => {
    expect(
      of(
        {
          status: "insufficient merged changes",
          merged: 2,
          measured: 1,
          needed: 5,
        },
        { status: "ok", merged: 5, measured: 4, medianSeconds: 900 },
      ),
    ).toBe(
      "Lead time per merged change: not read, 1 of 2 merged changes measured in this range (5 needed); average 900s over the trailing 7 days",
    );
  });

  it("says there is no average when the trailing days have too few measured merged changes", () => {
    expect(
      of(
        { status: "ok", merged: 5, measured: 5, medianSeconds: 1200 },
        {
          status: "insufficient merged changes",
          merged: 0,
          measured: 0,
          needed: 5,
        },
      ),
    ).toBe(
      "Lead time per merged change: 1200s median (5 of 5 merged changes measured); no average: 0 of 0 merged changes measured in the trailing 7 days (5 needed)",
    );
  });
});
