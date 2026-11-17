import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DecisionRoute,
  DecisionRouteSignal,
  Kind,
  LedgerEvent,
} from "../ledger/index.js";
import { ownerRoutes } from "./owner-routes.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";

// Factories, not automocks: an automock loads the real module, which the budget charges to each test.
vi.mock("./github-waits.js", () => ({ time: vi.fn() }));
vi.mock("./scope.js", () => ({ inWindow: vi.fn() }));

/** The window is [10, 1000) in milliseconds. */
const WINDOW: [number, number] = [10, 1000];

/** An event whose id is its time in milliseconds, so the mocked clock reads it back. */
function event(ms: number, kind: Kind): LedgerEvent {
  return {
    schema: 1,
    id: String(ms),
    source: "claude",
    kind,
    occurredAt: new Date(ms).toISOString(),
    recordedAt: new Date(ms).toISOString(),
  };
}

/** A decision.routed event: where the router sent the question, and the rule that decided it. */
function routed(
  ms: number,
  route: DecisionRoute,
  signal: DecisionRouteSignal,
): LedgerEvent {
  return { ...event(ms, "decision.routed"), route, signal };
}

beforeEach(() => {
  vi.mocked(time).mockImplementation((e) => Number(e.id));
  vi.mocked(inWindow).mockImplementation(
    (span, at) => at >= span[0] && at < span[1],
  );
});

describe("ownerRoutes: owner-routed questions per signal (ADR 0120)", () => {
  it("counts owner-routed questions by the signal that routed each, with every owner signal present and zero where none", () => {
    const events = [
      routed(12, "owner", "matched"),
      routed(13, "owner", "matched"),
      routed(14, "owner", "escalated"),
    ];

    expect(ownerRoutes(events, WINDOW)).toMatchObject({
      owner: 3,
      advisor: 0,
      bySignal: {
        "reserved-category": 0,
        matched: 2,
        "advisor-files": 0,
        escalated: 1,
        unclassifiable: 0,
      },
    });
  });

  it("counts advisor-routed questions apart from the owner's, and not as an owner signal", () => {
    const quality = ownerRoutes([routed(12, "advisor", "agreed")], WINDOW);

    expect(quality.advisor).toBe(1);
    expect(quality.owner).toBe(0);
    expect(Object.keys(quality.bySignal)).not.toContain("agreed");
  });

  it("counts only routes inside the window, and only decision.routed events", () => {
    const events = [
      routed(5, "owner", "matched"),
      routed(1000, "owner", "matched"),
      {
        ...event(12, "decision.made"),
        route: "owner" as const,
        signal: "matched" as const,
      },
      routed(20, "owner", "reserved-category"),
    ];

    const routes = ownerRoutes(events, WINDOW);

    expect(routes.owner).toBe(1);
    expect(routes.bySignal.matched).toBe(0);
    expect(routes.bySignal["reserved-category"]).toBe(1);
  });
});
