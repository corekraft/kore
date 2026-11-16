import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import { qualifierWarnings } from "./qualifier-warnings.js";
import { inWindow } from "./scope.js";

vi.mock("./github-waits.js");
vi.mock("./scope.js");

const WINDOW: [number, number] = [0, 1000];

function event(kind: Kind) {
  return {
    schema: 1,
    id: "1",
    source: "claude",
    kind,
    occurredAt: "2026-01-02T03:04:05.000Z",
    recordedAt: "2026-01-02T03:04:05.000Z",
  } satisfies LedgerEvent;
}

beforeEach(() => {
  vi.mocked(time).mockReturnValue(1);
  vi.mocked(inWindow).mockReturnValue(true);
});

describe("qualifierWarnings", () => {
  it("is zero warnings over zero filed, with no per-filed figure, when nothing happened", () => {
    expect(qualifierWarnings([], WINDOW)).toEqual({
      warnings: 0,
      filed: 0,
      perFiled: null,
    });
  });

  it("counts the warnings over the ideas filed in the window", () => {
    const events = [
      event("qualifier.warned"),
      event("qualifier.warned"),
      event("qualifier.warned"),
      event("idea.filed"),
      event("idea.filed"),
      event("idea.filed"),
      event("idea.filed"),
      event("auto-approved"),
    ];

    expect(qualifierWarnings(events, WINDOW)).toEqual({
      warnings: 3,
      filed: 4,
      perFiled: 0.75,
    });
  });

  it("gives no per-filed figure while warnings exist with no idea filed, never a division by zero", () => {
    expect(qualifierWarnings([event("qualifier.warned")], WINDOW)).toEqual({
      warnings: 1,
      filed: 0,
      perFiled: null,
    });
  });

  it("leaves out warnings and filings outside the window", () => {
    vi.mocked(inWindow).mockReturnValue(false);

    expect(
      qualifierWarnings(
        [event("qualifier.warned"), event("idea.filed")],
        WINDOW,
      ),
    ).toEqual({ warnings: 0, filed: 0, perFiled: null });
  });
});
