import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { ideasWithWritingIn } from "./cost-waiting-ideas-writing.js";
import { levelOf, readingOf } from "./cost-waiting-shares.js";
import { ideaSharesIn } from "./cost-waiting-shares-ideas.js";
import { ideaSpanSeconds } from "./cost-waiting-shares-span.js";
import type { IdeaFigure } from "./cost-waiting-types.js";
import { planPricesOf } from "./plan-prices.js";

// Everything outside the unit is mocked: the idea rows read at the plan prices (their dollars are
// weighted tokens), the writers' spend by idea, an idea's span, and the share arithmetic.
vi.mock("./cost-waiting-ideas-writing.js", () => ({
  ideasWithWritingIn: vi.fn(),
}));
vi.mock("./cost-waiting-shares-span.js", () => ({ ideaSpanSeconds: vi.fn() }));
vi.mock("./plan-prices.js", () => ({ planPricesOf: vi.fn() }));
vi.mock("./cost-waiting-shares.js", () => ({
  readingOf: vi.fn(),
  levelOf: vi.fn(),
}));

const PLAN_PRICES = { "plan-model": {} } as never;
const WINDOW: [number, number] = [0, 10];
const OPTIONS = { prices: {}, minimum: 1, weeklyTokenCeiling: 100 };
const EVENTS = [] as LedgerEvent[];
const SIZE = "of one week's ceiling";

/** An idea row as the cost figures list it; at the plan prices its dollars are weighted tokens. */
const row = (idea: string, over: Partial<IdeaFigure> = {}): IdeaFigure => ({
  idea,
  dollars: 0,
  tokens: 0,
  leadTimeSeconds: null,
  outcome: null,
  ...over,
});

beforeEach(() => {
  vi.mocked(planPricesOf).mockReturnValue(PLAN_PRICES);
  vi.mocked(ideaSpanSeconds).mockImplementation((_events, idea) =>
    idea === "7" ? 3600 : null,
  );
  vi.mocked(readingOf).mockImplementation(
    (label, unit, { ceiling }) =>
      ({
        label,
        status: "measured",
        share: ceiling === undefined ? "not set" : unit.plan / ceiling,
        spanSeconds: unit.spanSeconds,
      }) as never,
  );
  vi.mocked(levelOf).mockImplementation(
    (label, units, { minimum }) =>
      ({
        label,
        status: "measured",
        units: units.length,
        needed: minimum,
        total: units.reduce((sum, u) => sum + u.plan, 0) / 100,
        median: null,
        p90: null,
      }) as never,
  );
});

describe("idea shares: an idea's total weighted tokens over one week's ceiling", () => {
  it("reads an idea at the plan prices, with its writers' spend, as a size with its span beside it", () => {
    vi.mocked(ideasWithWritingIn).mockReturnValue({
      ideas: [row("7", { dollars: 25 })],
    } as never);

    const shares = ideaSharesIn(EVENTS, WINDOW, OPTIONS);

    expect(ideasWithWritingIn).toHaveBeenCalledWith(EVENTS, WINDOW, {
      ...OPTIONS,
      prices: PLAN_PRICES,
    });
    expect(shares.rows).toEqual([
      {
        idea: "7",
        share: {
          label: SIZE,
          status: "measured",
          share: 0.25,
          spanSeconds: 3600,
        },
      },
    ]);
    expect(shares).toMatchObject({ total: 0.25 });
  });

  it("gives an idea with no stamped event a null span, not a zero one", () => {
    vi.mocked(ideasWithWritingIn).mockReturnValue({
      ideas: [row("9", { dollars: 10 })],
    } as never);

    const shares = ideaSharesIn(EVENTS, WINDOW, OPTIONS);

    expect(readingOf).toHaveBeenCalledWith(
      SIZE,
      { plan: 10, unweighted: [], spanSeconds: null },
      { ceiling: 100 },
    );
    expect(shares.rows[0]?.share).toMatchObject({ spanSeconds: null });
  });
});

describe("idea shares: a model with no plan weight and a missing ceiling are never a zero", () => {
  it("names the models with no plan weight where the idea's dollars at the plan prices are null", () => {
    vi.mocked(ideasWithWritingIn).mockReturnValue({
      ideas: [row("7", { dollars: null, unpricedModels: ["mystery"] })],
    } as never);

    ideaSharesIn(EVENTS, WINDOW, OPTIONS);

    expect(levelOf).toHaveBeenCalledWith(
      SIZE,
      [{ plan: 0, unweighted: ["mystery"], spanSeconds: 3600 }],
      { ceiling: 100, minimum: 1 },
    );
  });

  it("passes no ceiling through when the config names none", () => {
    vi.mocked(ideasWithWritingIn).mockReturnValue({
      ideas: [row("7", { dollars: 25 })],
    } as never);

    const shares = ideaSharesIn(EVENTS, WINDOW, {
      ...OPTIONS,
      weeklyTokenCeiling: undefined,
    });

    expect(shares.rows[0]?.share).toMatchObject({ share: "not set" });
  });
});
