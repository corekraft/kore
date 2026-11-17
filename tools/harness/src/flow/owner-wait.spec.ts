import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { waitingOnPerson } from "./owner-wait.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-waits.js", () => ({ time: vi.fn() }));
vi.mock("./scope.js", () => ({ inWindow: vi.fn() }));

/** The window is [0, 1000000) milliseconds; the report's as-of time is 900000. */
const WINDOW: [number, number] = [0, 1_000_000];
const ASOF = new Date(900_000);

/** An event whose id is its time in milliseconds, with the pane or session that wrote it. */
function event(
  ms: number,
  kind: Kind,
  actor: { pane?: string; session?: string } = { pane: "p1" },
): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
    ...actor,
  };
}

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    (span, at) => at >= span[0] && at < span[1],
  );
});

describe("waitingOnPerson: the time a question waits on the owner (ADR 0120)", () => {
  it("counts the owner.asked questions inside the window, and no others", () => {
    const events = [
      event(100_000, "owner.asked"),
      event(2_000_000, "owner.asked"),
    ];

    expect(waitingOnPerson(events, WINDOW, ASOF)).toMatchObject({
      questions: 1,
    });
  });

  it("waits from a question to the next event of the same pane, in whole seconds", () => {
    const events = [
      event(100_000, "owner.asked"),
      event(150_000, "tool.start", { pane: "p2" }),
      event(220_000, "tool.start"),
    ];

    expect(waitingOnPerson(events, WINDOW, ASOF)).toEqual({
      questions: 1,
      answered: 1,
      unanswered: 0,
      waitingSeconds: 120,
      perQuestionSeconds: 120,
    });
  });

  it("does not count another pane's event as the owner's answer", () => {
    const events = [
      event(100_000, "owner.asked"),
      event(150_000, "tool.start", { pane: "p2" }),
    ];

    expect(waitingOnPerson(events, WINDOW, ASOF)).toMatchObject({
      answered: 0,
      unanswered: 1,
      waitingSeconds: 800,
    });
  });

  it("waits a question with no answer until the as-of time", () => {
    const events = [event(100_000, "owner.asked")];

    expect(waitingOnPerson(events, WINDOW, ASOF).waitingSeconds).toBe(800);
  });

  it("clips an unanswered question at the window's end, so a range does not charge time past it", () => {
    const events = [event(100_000, "owner.asked")];

    expect(waitingOnPerson(events, [0, 500_000], ASOF).waitingSeconds).toBe(
      400,
    );
  });

  it("keys a session with no pane by its session", () => {
    const events = [
      event(100_000, "owner.asked", { session: "s1" }),
      event(160_000, "tool.start", { session: "s1" }),
    ];

    expect(waitingOnPerson(events, WINDOW, ASOF)).toMatchObject({
      answered: 1,
      waitingSeconds: 60,
    });
  });

  it("gives the wait per question, and null when no question was asked", () => {
    expect(waitingOnPerson([], WINDOW, ASOF).perQuestionSeconds).toBeNull();

    const events = [
      event(100_000, "owner.asked", { pane: "p1" }),
      event(220_000, "tool.start", { pane: "p1" }),
      event(100_000, "owner.asked", { pane: "p2" }),
    ];

    expect(waitingOnPerson(events, WINDOW, ASOF)).toMatchObject({
      questions: 2,
      waitingSeconds: 920,
      perQuestionSeconds: 460,
    });
  });
});
