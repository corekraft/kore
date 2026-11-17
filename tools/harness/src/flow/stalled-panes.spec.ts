import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasOpenBackground,
  hasOpenQuestion,
  type Kind,
  type LedgerEvent,
} from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { stalledPanes } from "./stalled-panes.js";

vi.mock("../ledger/index.js", () => ({
  hasOpenBackground: vi.fn(),
  hasOpenQuestion: vi.fn(),
}));
vi.mock("./github-waits.js");
vi.mock("./scope.js");

const DAY = 86_400_000;
const MINUTE = 60_000;
/** The report window is the eleventh day. */
const WINDOW: [number, number] = [10 * DAY, 11 * DAY];
const AT = 10 * DAY;

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(
  ms: number,
  kind: Kind,
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...extra,
  } satisfies LedgerEvent;
}

/** A token.usage a session's Stop hook recorded on its pane. */
const tokens = (ms: number, session = "s1", pane = "w3:p9") =>
  event(ms, "token.usage", { session, pane, tokens: 1000 });

/** A pane.stalled the poll recorded on a pane. */
const stalled = (ms: number, pane = "w3:p9") =>
  event(ms, "pane.stalled", { source: "herdr", pane, agent: "writer" });

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    ([start, end], t) => t >= start && t < end,
  );
  vi.mocked(hasOpenBackground).mockReturnValue(false);
  vi.mocked(hasOpenQuestion).mockReturnValue(false);
});

describe("stalled panes: the detector's count", () => {
  it("counts a pane.stalled inside the window as recorded", () => {
    expect(
      stalledPanes([stalled(AT + MINUTE), stalled(9 * DAY)], WINDOW, 11 * DAY),
    ).toMatchObject({ recorded: 1 });
  });
});

describe("stalled panes: the token-usage silence count", () => {
  it("counts a session silent for more than fifteen minutes with no result after its last tokens", () => {
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 16 * MINUTE)).toEqual({
      silenceSeconds: 900,
      recorded: 0,
      fromTokenUsage: 1,
      backgroundExcluded: 0,
      questionExcluded: 0,
    });
  });

  it("leaves out a session silent for exactly fifteen minutes, since the limit is above it", () => {
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 15 * MINUTE)).toMatchObject({
      fromTokenUsage: 0,
    });
  });
});

describe("stalled panes: what token silence leaves out", () => {
  it("leaves out a session that printed a result after its last tokens", () => {
    expect(
      stalledPanes(
        [
          tokens(AT),
          event(AT + 5 * MINUTE, "session.result", {
            session: "s1",
            pane: "w3:p9",
            result: "done",
          }),
        ],
        WINDOW,
        AT + 30 * MINUTE,
      ),
    ).toMatchObject({ fromTokenUsage: 0 });
  });

  it("leaves out a session whose pane finished after its last tokens", () => {
    expect(
      stalledPanes(
        [
          tokens(AT),
          event(AT + 5 * MINUTE, "pane.finished", {
            source: "herdr",
            pane: "w3:p9",
            result: "done",
          }),
        ],
        WINDOW,
        AT + 30 * MINUTE,
      ),
    ).toMatchObject({ fromTokenUsage: 0 });
  });

  it("leaves out a session whose pane has a background command open, and counts that exclusion", () => {
    vi.mocked(hasOpenBackground).mockReturnValue(true);
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 30 * MINUTE)).toMatchObject({
      fromTokenUsage: 0,
      backgroundExcluded: 1,
    });
    expect(hasOpenBackground).toHaveBeenCalledWith(
      expect.any(Array),
      "w3:p9",
      AT + 30 * MINUTE,
    );
  });

  it("measures silence to the window's end when the as-of time is later", () => {
    expect(
      stalledPanes([tokens(AT)], [AT, AT + 60 * MINUTE], AT + 5 * DAY),
    ).toMatchObject({ fromTokenUsage: 1 });
  });

  it("measures silence to the as-of time when that is before the window's end", () => {
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 10 * MINUTE)).toMatchObject({
      fromTokenUsage: 0,
    });
  });
});

describe("stalled panes: an open reserved question (#854)", () => {
  it("leaves out a session whose pane waits on an open reserved question, and counts that exclusion", () => {
    vi.mocked(hasOpenQuestion).mockReturnValue(true);
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 30 * MINUTE)).toEqual({
      silenceSeconds: 900,
      recorded: 0,
      fromTokenUsage: 0,
      backgroundExcluded: 0,
      questionExcluded: 1,
    });
    expect(hasOpenQuestion).toHaveBeenCalledWith(
      expect.any(Array),
      "w3:p9",
      AT + 30 * MINUTE,
    );
  });

  it("counts a silent session with both a background command and an open question as background, once", () => {
    vi.mocked(hasOpenBackground).mockReturnValue(true);
    vi.mocked(hasOpenQuestion).mockReturnValue(true);
    expect(stalledPanes([tokens(AT)], WINDOW, AT + 30 * MINUTE)).toMatchObject({
      backgroundExcluded: 1,
      questionExcluded: 0,
    });
  });
});

describe("stalled panes: the events it counts", () => {
  it("ignores every kind other than the events it counts", () => {
    expect(
      stalledPanes(
        [event(AT, "session.stop", { pane: "w3:p9" })],
        WINDOW,
        AT + 30 * MINUTE,
      ),
    ).toEqual({
      silenceSeconds: 900,
      recorded: 0,
      fromTokenUsage: 0,
      backgroundExcluded: 0,
      questionExcluded: 0,
    });
  });
});
