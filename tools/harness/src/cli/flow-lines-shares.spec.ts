import { describe, expect, it } from "vitest";
import type { FlowReport } from "../flow/index.js";
import { shareLines } from "./flow-lines-shares.js";

type Shares = FlowReport["costWaiting"]["ceilingShares"];

const RATE = "of the weekly ceiling";
const SIZE = "of one week's ceiling";

const AGENT_LEVEL = {
  label: RATE,
  units: 2,
  needed: 1,
  status: "measured",
  total: 1.25,
  median: 0.4,
  p90: 0.85,
  days: 7,
} as const;

const shares = (over: Partial<Shares> = {}): Shares =>
  ({
    ceiling: 1_000_000,
    agents: { ...AGENT_LEVEL, rows: {} },
    mergedChanges: {
      label: SIZE,
      units: 0,
      needed: 5,
      status: "insufficient",
      rows: [],
    },
    ideas: {
      label: SIZE,
      units: 0,
      needed: 5,
      status: "insufficient",
      rows: [],
    },
    ...over,
  }) as unknown as Shares;

describe("ceiling share lines: a rate and a size are labelled apart", () => {
  it("states the ceiling, then each level under its own label, the agent rate over its 7 days", () => {
    expect(shareLines(shares())).toEqual([
      "Shares of the weekly token ceiling (plan-weighted tokens; ceiling 1000000):",
      "  Per agent, a rate over the trailing 7 days, of the weekly ceiling: total 125%, median 40%, p90 85%",
      "  Per merged change, a size, of one week's ceiling: not read, 0 change(s), 5 needed",
      "  Per idea, a size, of one week's ceiling: not read, 0 idea(s), 5 needed",
    ]);
  });

  it("prints each agent row as a rate, the main session saying assumed model, a thin role not read", () => {
    const lines = shareLines(
      shares({
        agents: {
          ...AGENT_LEVEL,
          rows: {
            writer: { label: RATE, status: "measured", share: 0.1 },
            orchestrate: {
              label: RATE,
              status: "measured",
              share: 0.0425,
              basis: "assumed model",
            },
            judge: { label: RATE, status: "insufficient", units: 1, needed: 2 },
            reader: {
              label: RATE,
              status: "insufficient weights",
              models: ["x-model", "y-model"],
            },
          },
        },
      } as unknown as Partial<Shares>),
    );

    expect(lines.slice(2, 6)).toEqual([
      "    writer: 10% of the weekly ceiling",
      "    orchestrate: 4.25% of the weekly ceiling (assumed model)",
      "    judge: not read, 1 session(s), 2 needed",
      "    reader: not read, no plan weight for x-model, y-model",
    ]);
  });
});

describe("ceiling share lines: a size has its span beside it", () => {
  it("prints each merged change and idea as a size with its span beside it, an unjoined change not read", () => {
    const lines = shareLines(
      shares({
        mergedChanges: {
          label: SIZE,
          units: 1,
          needed: 1,
          status: "measured",
          total: 0.5,
          median: 0.5,
          p90: 0.5,
          rows: [
            {
              number: 12,
              share: {
                label: SIZE,
                status: "measured",
                share: 0.5,
                spanSeconds: 3600,
              },
            },
            { number: 13, share: null },
          ],
        },
        ideas: {
          label: SIZE,
          units: 2,
          needed: 1,
          status: "measured",
          total: 0.3,
          median: 0.15,
          p90: 0.2,
          rows: [
            {
              idea: "7",
              share: {
                label: SIZE,
                status: "measured",
                share: 0.2,
                spanSeconds: 60.4,
              },
            },
            {
              idea: "9",
              share: {
                label: SIZE,
                status: "measured",
                share: 0.1,
                spanSeconds: null,
              },
            },
          ],
        },
      } as unknown as Partial<Shares>),
    );

    expect(lines.slice(2)).toEqual([
      "  Per merged change, a size, of one week's ceiling: total 50%, median 50%, p90 50%",
      "    PR #12: 50% of one week's ceiling, span 3600s",
      "    PR #13: not read, no writer launch joins it",
      "  Per idea, a size, of one week's ceiling: total 30%, median 15%, p90 20%",
      "    Idea 7: 20% of one week's ceiling, span 60s",
      "    Idea 9: 10% of one week's ceiling, span none",
    ]);
  });
});

describe("ceiling share lines: a missing ceiling and an unweighted model are never a zero", () => {
  it("prints not set, never zero, for every share when the config names no ceiling", () => {
    const lines = shareLines(
      shares({
        ceiling: "not set",
        agents: {
          ...AGENT_LEVEL,
          total: "not set",
          median: "not set",
          p90: "not set",
          rows: {
            writer: { label: RATE, status: "measured", share: "not set" },
          },
        },
      } as unknown as Partial<Shares>),
    );

    expect(lines[0]).toBe(
      "Shares of the weekly token ceiling (plan-weighted tokens; ceiling not set):",
    );
    expect(lines[1]).toBe(
      "  Per agent, a rate over the trailing 7 days, of the weekly ceiling: total not set, median not set, p90 not set",
    );
    expect(lines[2]).toBe("    writer: not set of the weekly ceiling");
  });

  it("names the models with no plan weight at a level instead of a sum", () => {
    const lines = shareLines(
      shares({
        ideas: {
          label: SIZE,
          units: 2,
          needed: 1,
          status: "insufficient weights",
          models: ["mystery"],
          rows: [],
        },
      } as unknown as Partial<Shares>),
    );

    expect(lines[3]).toBe(
      "  Per idea, a size, of one week's ceiling: not read, no plan weight for mystery",
    );
  });
});
