// The `Last retrospective:` marker the scan's window opens at: the latest marker across
// the plans, a marker's instant, and the window's start. The scan's own tests reach these
// through retro-scan.ts; this file tests them where they live.

import { describe, expect, it } from "vitest";
import {
  lastRetrospective,
  markerInstant,
  MarkerError,
  windowStart,
} from "./retro-marker.js";

describe("markerInstant: a UTC timestamp is its instant, and a value that does not round-trip is not a marker", () => {
  it("reads a UTC timestamp as its instant", () => {
    expect(markerInstant("2026-11-12T18:00:00Z")).toBe(
      Date.parse("2026-11-12T18:00:00Z"),
    );
  });

  it("refuses February 30, rather than rolling it over to March 2", () => {
    expect(markerInstant("2026-02-30")).toBeNaN();
  });
});

describe("lastRetrospective: the latest marker across the plans", () => {
  it("picks the later timestamp across two plans", () => {
    expect(
      lastRetrospective({
        "3.md": "Last retrospective: 2026-11-12T10:00:00Z\n",
        "4.md": "Last retrospective: 2026-11-12T18:00:00Z\n",
      }),
    ).toBe("2026-11-12T18:00:00Z");
  });

  it("returns null when no plan holds a marker", () => {
    expect(lastRetrospective({ "3.md": "# Plan\n" })).toBeNull();
  });

  it("names the plan and line of a value that is not a marker", () => {
    expect(() =>
      lastRetrospective({
        "3.md": "# Plan\nLast retrospective: 2026-02-30\n",
      }),
    ).toThrow(
      new MarkerError(
        'infra/plans/3.md:2: "2026-02-30" is not a retrospective marker; write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ',
      ),
    );
  });
});

describe("windowStart: the window opens at the marker's instant, or at the epoch without one", () => {
  it("opens at the epoch when there is no marker", () => {
    expect(windowStart(undefined)).toBe(0);
  });

  it("refuses a value that is not a marker", () => {
    expect(() => windowStart("yesterday")).toThrow(MarkerError);
  });
});
