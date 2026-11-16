import { describe, expect, it } from "vitest";
import { buildReport } from "../src/flow/index.js";
import { T0, at } from "../src/testing/index.js";

const ASOF = new Date(T0 + 1_000_000_000);

// Window: 1000 s to 2000 s after T0. Lead time runs from each PR's opening.
const WINDOW = {
  since: new Date(T0 + 1000 * 1000),
  until: new Date(T0 + 2000 * 1000),
};
const EVENTS = [
  at(0, "pr.opened", { number: 11 }),
  at(100, "pr.opened", { number: 12 }),
  at(1200, "pr.merged", { number: 11 }),
  at(1700, "pr.merged", { number: 12 }),
  at(1500, "send-back", {
    number: 11,
    label: "too slow @abcdef1",
    category: "scope",
  }),
  at(1800, "send-back", {
    number: 12,
    label: "wrong file @1234567",
    category: "conflict",
  }),
  at(2500, "pr.merged", { number: 13 }),
];

const NO_TRAILING = {
  status: "insufficient merged changes",
  merged: 0,
  needed: 2,
};

describe("flow report send-backs per merged change (#830)", () => {
  it("divides the send-backs in the window by its merged changes, with the trailing average", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.sendBacksPerMergedChange).toEqual({
      trailingDays: 7,
      minMergedChanges: 2,
      current: { status: "ok", sendBacks: 2, merged: 2, perMerged: 1 },
      trailingAverage: NO_TRAILING,
    });
  });

  it("reads no send-back figure below the placeholder minimum, so a thin window is never read", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.sendBacksPerMergedChange.current).toEqual({
      status: "insufficient merged changes",
      merged: 2,
      needed: 5,
    });
  });
});

describe("flow report lead time per merged change (#830)", () => {
  it("takes each merged change's lead time from its pull request's opening, and reports the median", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
      cost: { minMergedChanges: 2 },
    });

    expect(r.leadTimePerMergedChange).toEqual({
      trailingDays: 7,
      minMergedChanges: 2,
      current: { status: "ok", merged: 2, measured: 2, medianSeconds: 1400 },
      trailingAverage: { ...NO_TRAILING, measured: 0 },
    });
  });

  it("reads no lead time below the placeholder minimum, so a thin window is never read", () => {
    const r = buildReport(EVENTS, {
      asOf: ASOF,
      minCompletedIdeas: 1,
      ...WINDOW,
    });

    expect(r.leadTimePerMergedChange.current).toEqual({
      status: "insufficient merged changes",
      merged: 2,
      measured: 2,
      needed: 5,
    });
  });

  it("measures a merge with no opening event from the opened time the merge carries", () => {
    const r = buildReport(
      [
        at(1900, "pr.merged", {
          number: 14,
          openedAt: new Date(T0 + 1500 * 1000).toISOString(),
        }),
      ],
      {
        asOf: ASOF,
        minCompletedIdeas: 1,
        ...WINDOW,
        cost: { minMergedChanges: 1 },
      },
    );

    expect(r.leadTimePerMergedChange.current).toEqual({
      status: "ok",
      merged: 1,
      measured: 1,
      medianSeconds: 400,
    });
  });
});
