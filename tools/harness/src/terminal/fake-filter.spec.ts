import { describe, expect, it } from "vitest";
import { keeps } from "./fake-filter.js";
import type { TerminalEvent } from "./port.js";

const EVENT: TerminalEvent = { kind: "changed", terminal: "t2" };
const LABELS = { "kore-session": "s1", role: "writer" };

describe("keeps: the fake's event filter", () => {
  it("keeps every event when no filter is given", () => {
    expect(keeps(EVENT, LABELS, {})).toBe(true);
  });

  it("keeps an event only for the terminal asked for", () => {
    expect(keeps(EVENT, LABELS, { terminal: "t3" })).toBe(false);
    expect(keeps(EVENT, LABELS, { terminal: "t2" })).toBe(true);
  });

  it("keeps an event only when its terminal carries every label given", () => {
    expect(keeps(EVENT, LABELS, { labels: { "kore-session": "s1" } })).toBe(
      true,
    );
    expect(keeps(EVENT, LABELS, { labels: { "kore-session": "s2" } })).toBe(
      false,
    );
    expect(
      keeps(EVENT, LABELS, {
        labels: { "kore-session": "s1", role: "reviewer" },
      }),
    ).toBe(false);
  });

  it("keeps no labelled event for a terminal the fake has removed, since it carries no labels", () => {
    expect(keeps(EVENT, undefined, { labels: { "kore-session": "s1" } })).toBe(
      false,
    );
    expect(keeps(EVENT, undefined, {})).toBe(true);
  });
});
