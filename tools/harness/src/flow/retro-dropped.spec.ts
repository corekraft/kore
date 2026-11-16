import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { retroProposalsDropped } from "./retro-dropped.js";
import { inWindow } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: [number, number] = [0, 1000];

function event(kind: Kind, number?: number) {
  return {
    schema: 1,
    id: "1",
    source: "claude",
    kind,
    occurredAt: "2026-01-02T03:04:05.000Z",
    recordedAt: "2026-01-02T03:04:05.000Z",
    ...(number === undefined ? {} : { number }),
  } satisfies LedgerEvent;
}

beforeEach(() => {
  vi.mocked(time).mockReturnValue(1);
  vi.mocked(inWindow).mockReturnValue(true);
});

describe("retroProposalsDropped", () => {
  it("is zero when no retro dropped a proposal", () => {
    expect(retroProposalsDropped([event("idea.filed")], WINDOW)).toBe(0);
  });

  it("adds up what every retro in the window dropped", () => {
    expect(
      retroProposalsDropped(
        [
          event("retro.dropped", 2),
          event("retro.dropped", 3),
          event("outcome", 9),
        ],
        WINDOW,
      ),
    ).toBe(5);
  });

  it("leaves out a retro outside the window", () => {
    vi.mocked(inWindow).mockReturnValue(false);

    expect(retroProposalsDropped([event("retro.dropped", 4)], WINDOW)).toBe(0);
  });
});
