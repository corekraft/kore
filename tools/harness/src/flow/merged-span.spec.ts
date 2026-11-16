import { describe, expect, it } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import {
  DAY_MS,
  DEFAULT_MERGED_TRAILING_DAYS,
  mergedIn,
  trailingBefore,
} from "./merged-span.js";

/** An event whose occurredAt is `ms` after the epoch. */
const ev = (ms: number, kind: Kind): LedgerEvent => ({
  schema: 1,
  id: String(ms),
  source: "github",
  kind,
  occurredAt: new Date(ms).toISOString(),
  recordedAt: new Date(ms).toISOString(),
});

describe("mergedIn: the merged changes in a span", () => {
  it("counts the pr.merged events inside the span, its end excluded, and no other kind", () => {
    expect(
      mergedIn(
        [
          ev(1 * DAY_MS, "pr.merged"),
          ev(2 * DAY_MS, "pr.merged"),
          ev(2 * DAY_MS, "pr.opened"),
          ev(3 * DAY_MS, "pr.merged"),
        ],
        [1 * DAY_MS, 3 * DAY_MS],
      ),
    ).toBe(2);
  });
});

describe("trailingBefore: the span a per-merged trailing average reads", () => {
  it("ends the trailing days where the window starts", () => {
    expect(
      trailingBefore([10 * DAY_MS, 11 * DAY_MS], 1, new Date(20 * DAY_MS)),
    ).toEqual([9 * DAY_MS, 10 * DAY_MS]);
  });

  it("ends the trailing days at as-of when the window has no start", () => {
    expect(
      trailingBefore([-Infinity, 11 * DAY_MS], 1, new Date(20 * DAY_MS)),
    ).toEqual([19 * DAY_MS, 20 * DAY_MS]);
  });

  it("reads seven trailing days by default, the same as the other per-merged figures (#859)", () => {
    expect(DEFAULT_MERGED_TRAILING_DAYS).toBe(7);
  });
});
