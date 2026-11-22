import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerEvent } from "../ledger/index.js";
import { finishDetection, leadTime, stalledPanes } from "./idea-metrics.js";
import {
  sourcedIdeas,
  sourceSplit,
  type SourceSplit,
} from "./ledger-source.js";
import { terminalMainSession } from "./main-session.js";
import { sourceFigures } from "./source-figures.js";

vi.mock("./idea-metrics.js");
vi.mock("./ledger-source.js");
vi.mock("./main-session.js");

const WINDOW: [number, number] = [0, 1000];
const ASOF = 500;
const EVENTS = [{ id: "all" }] as unknown as LedgerEvent[];
const NAMED = [{ id: "named" }] as unknown as LedgerEvent[];
const HERDR_VIEW = [{ id: "herdr" }] as unknown as LedgerEvent[];
const TERMINAL_VIEW = [{ id: "terminal" }] as unknown as LedgerEvent[];
const BYIDEA = new Map<string, LedgerEvent[]>();
const HERDR_IDEAS = new Map<string, LedgerEvent[]>([["#1", []]]);
const TERMINAL_IDEAS = new Map<string, LedgerEvent[]>([["#2", []]]);
const FINISH_HERDR = { results: 1 };
const FINISH_TERMINAL = { results: 2 };
const STALLS_HERDR = { recorded: 1 };
const STALLS_TERMINAL = { recorded: 2 };
const LEAD_HERDR = { medianSeconds: 1 };
const LEAD_TERMINAL = { medianSeconds: 2 };
const MAIN_TERMINAL = { mainSession: "terminal" };

/** A split with the given terminal flag; its view returns the herdr or the terminal events, and is returned beside it. */
function splitOf(terminal: boolean) {
  const view = vi.fn((_events: LedgerEvent[], source: string) =>
    source === "herdr" ? HERDR_VIEW : TERMINAL_VIEW,
  );
  const split: SourceSplit = { terminal, of: vi.fn(), view };
  return { split, view };
}

beforeEach(() => {
  vi.mocked(finishDetection).mockImplementation(
    (events) =>
      (events === HERDR_VIEW ? FINISH_HERDR : FINISH_TERMINAL) as never,
  );
  vi.mocked(stalledPanes).mockImplementation(
    (events) =>
      (events === HERDR_VIEW ? STALLS_HERDR : STALLS_TERMINAL) as never,
  );
  vi.mocked(leadTime).mockImplementation(
    (ideas) => (ideas === HERDR_IDEAS ? LEAD_HERDR : LEAD_TERMINAL) as never,
  );
  vi.mocked(sourcedIdeas).mockImplementation((_byIdea, _split, source) =>
    source === "herdr" ? HERDR_IDEAS : TERMINAL_IDEAS,
  );
  vi.mocked(terminalMainSession).mockReturnValue(MAIN_TERMINAL as never);
});

describe("sourceFigures reads one ledger with no terminal event as the herdr reading alone", () => {
  it("reads the herdr view's pane figures at the top level and gives no terminal reading", () => {
    const { split, view } = splitOf(false);
    vi.mocked(sourceSplit).mockReturnValue(split);
    const figures = sourceFigures(EVENTS, NAMED, BYIDEA, WINDOW, ASOF);
    expect(view).toHaveBeenCalledWith(NAMED, "herdr");
    expect(finishDetection).toHaveBeenCalledWith(HERDR_VIEW, WINDOW);
    expect(stalledPanes).toHaveBeenCalledWith(HERDR_VIEW, WINDOW, ASOF);
    expect(leadTime).toHaveBeenCalledWith(HERDR_IDEAS, WINDOW);
    expect(terminalMainSession).not.toHaveBeenCalled();
    expect(figures).toEqual({
      finishDetection: FINISH_HERDR,
      stalledPanes: STALLS_HERDR,
      leadTime: LEAD_HERDR,
      terminal: null,
    });
  });
});

describe("sourceFigures reads the herdr and the terminal source apart once a terminal event is in the ledger", () => {
  it("gives the terminal reading its own view, never the view of both sources together", () => {
    vi.mocked(sourceSplit).mockReturnValue(splitOf(true).split);
    const figures = sourceFigures(EVENTS, NAMED, BYIDEA, WINDOW, ASOF);
    expect(finishDetection).toHaveBeenCalledWith(HERDR_VIEW, WINDOW);
    expect(finishDetection).toHaveBeenCalledWith(TERMINAL_VIEW, WINDOW);
    expect(finishDetection).not.toHaveBeenCalledWith(NAMED, WINDOW);
    expect(figures.terminal).toEqual({
      finishDetection: FINISH_TERMINAL,
      stalledPanes: STALLS_TERMINAL,
      leadTime: LEAD_TERMINAL,
      mainSession: MAIN_TERMINAL,
    });
    expect(figures.finishDetection).toBe(FINISH_HERDR);
    expect(figures.stalledPanes).toBe(STALLS_HERDR);
  });

  it("reads lead time per source over the ideas each source reads, and the terminal main session as insufficient", () => {
    const { split } = splitOf(true);
    vi.mocked(sourceSplit).mockReturnValue(split);
    const figures = sourceFigures(EVENTS, NAMED, BYIDEA, WINDOW, ASOF);
    expect(sourcedIdeas).toHaveBeenCalledWith(BYIDEA, split, "herdr");
    expect(sourcedIdeas).toHaveBeenCalledWith(BYIDEA, split, "terminal");
    expect(leadTime).toHaveBeenCalledWith(TERMINAL_IDEAS, WINDOW);
    expect(figures.leadTime).toBe(LEAD_HERDR);
    expect(figures.terminal?.leadTime).toBe(LEAD_TERMINAL);
    expect(terminalMainSession).toHaveBeenCalledWith();
  });
});
