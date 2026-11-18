import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { ideaSharesIn } from "./cost-waiting-shares-ideas.js";
import { agentSharesIn } from "./cost-waiting-shares-agents.js";
import { mergedSharesIn } from "./cost-waiting-shares-merged.js";
import { ceilingSharesIn } from "./cost-waiting-ceiling-shares.js";
import type { MergedChangeFigure } from "./cost-waiting-types.js";

// Everything outside the unit is mocked: each level's shares. The event time is mocked too: an
// event's occurredAt is its time in milliseconds.
vi.mock("./cost-waiting-shares-agents.js", () => ({ agentSharesIn: vi.fn() }));
vi.mock("./cost-waiting-shares-merged.js", () => ({ mergedSharesIn: vi.fn() }));
vi.mock("./cost-waiting-shares-ideas.js", () => ({ ideaSharesIn: vi.fn() }));
vi.mock("./github-waits.js", () => ({
  time: (event: LedgerEvent) => Number(event.occurredAt),
}));

const DAY = 86_400_000;
const AGENTS = { label: "agents" } as never;
const MERGED = { label: "merged" } as never;
const IDEAS = { label: "ideas" } as never;
const OPTIONS = { prices: {}, minimum: 2, weeklyTokenCeiling: 500 };
const CHANGES = [{ number: 1 }] as MergedChangeFigure[];
const at = (ms: number) => ({ occurredAt: String(ms) }) as LedgerEvent;

beforeEach(() => {
  vi.mocked(agentSharesIn).mockReturnValue(AGENTS);
  vi.mocked(mergedSharesIn).mockReturnValue(MERGED);
  vi.mocked(ideaSharesIn).mockReturnValue(IDEAS);
});

describe("the shares of the weekly ceiling at each level", () => {
  it("states the ceiling and the three levels, the agents read over the 7 days ending where the window ends", () => {
    const events = [at(1)];
    const window: [number, number] = [10 * DAY, 20 * DAY];

    const shares = ceilingSharesIn(events, window, OPTIONS, CHANGES);

    expect(shares).toEqual({
      ceiling: 500,
      agents: AGENTS,
      mergedChanges: MERGED,
      ideas: IDEAS,
    });
    expect(agentSharesIn).toHaveBeenCalledWith(
      events,
      [13 * DAY, 20 * DAY],
      OPTIONS,
    );
    expect(mergedSharesIn).toHaveBeenCalledWith(
      events,
      window,
      OPTIONS,
      CHANGES,
    );
    expect(ideaSharesIn).toHaveBeenCalledWith(events, window, OPTIONS);
  });

  it("ends the 7 days at as-of when the window has no end", () => {
    const window: [number, number] = [0, Infinity];

    ceilingSharesIn(
      [at(1)],
      window,
      { ...OPTIONS, asOf: new Date(30 * DAY) },
      CHANGES,
    );

    expect(agentSharesIn).toHaveBeenCalledWith(
      expect.anything(),
      [23 * DAY, 30 * DAY],
      expect.anything(),
    );
  });

  it("ends the 7 days at the latest event when the window has no end and no as-of is given", () => {
    const window: [number, number] = [0, Infinity];

    ceilingSharesIn(
      [at(2 * DAY), at(9 * DAY), at(5 * DAY)],
      window,
      OPTIONS,
      CHANGES,
    );

    expect(agentSharesIn).toHaveBeenCalledWith(
      expect.anything(),
      [2 * DAY, 9 * DAY],
      expect.anything(),
    );
  });

  it("states the ceiling as not set, never zero, when the config names none", () => {
    const shares = ceilingSharesIn(
      [],
      [0, DAY],
      { ...OPTIONS, weeklyTokenCeiling: undefined },
      CHANGES,
    );

    expect(shares.ceiling).toBe("not set");
  });
});
