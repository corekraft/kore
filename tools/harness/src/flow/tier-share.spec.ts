import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { inWindow } from "./scope.js";
import { tierShares } from "./tier-share.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: [number, number] = [0, 1000];
let next = 0;

function launch(role: string, tierSource?: LedgerEvent["tierSource"]) {
  next += 1;
  return {
    schema: 1,
    id: String(next),
    source: "herdr",
    kind: "session.launch",
    occurredAt: "2026-01-02T03:04:05.000Z",
    recordedAt: "2026-01-02T03:04:05.000Z",
    role,
    tier: "claude-sonnet-5-5",
    ...(tierSource === undefined ? {} : { tierSource }),
  } satisfies LedgerEvent;
}

beforeEach(() => {
  next = 0;
  vi.mocked(time).mockReturnValue(1);
  vi.mocked(inWindow).mockReturnValue(true);
});

describe("tierShares", () => {
  it("counts each role's launches by tier source, with launches from before the field as their own unknown group", () => {
    const shares = tierShares(
      [
        launch("writer", "definition"),
        launch("writer", "override"),
        launch("writer", "escalation"),
        launch("writer"),
        launch("judge", "definition"),
      ],
      WINDOW,
    );

    expect(shares).toEqual([
      {
        role: "judge",
        launches: 1,
        definition: 1,
        escalation: 0,
        override: 0,
        unknown: 0,
        overrideShare: 0,
      },
      {
        role: "writer",
        launches: 4,
        definition: 1,
        escalation: 1,
        override: 1,
        unknown: 1,
        overrideShare: 1 / 3,
      },
    ]);
  });

  it("measures the override share over launches that know their source, never counting unknown ones", () => {
    const [writer] = tierShares(
      [launch("writer"), launch("writer"), launch("writer", "override")],
      WINDOW,
    );

    expect(writer?.overrideShare).toBe(1);
    expect(writer?.unknown).toBe(2);
  });

  it("reports a null override share when no launch knows its source", () => {
    const [writer] = tierShares([launch("writer")], WINDOW);

    expect(writer?.overrideShare).toBeNull();
  });

  it("leaves out launches outside the window and events that are not launches", () => {
    vi.mocked(inWindow).mockReturnValue(false);
    const other = { ...launch("writer"), kind: "pr.opened" as Kind };

    expect(tierShares([launch("writer"), other], WINDOW)).toEqual([]);
  });
});
