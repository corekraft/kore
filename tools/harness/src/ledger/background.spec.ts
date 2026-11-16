import { describe, expect, it } from "vitest";
import { hasOpenBackground } from "./background.js";
import type { LedgerEvent } from "./schema.js";

const T0 = Date.parse("2026-01-02T03:00:00.000Z");
const at = (minutes: number) => T0 + minutes * 60_000;

/** A ledger event on a pane, at a minute after T0. */
function event(
  minutes: number,
  kind: LedgerEvent["kind"],
  extra: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    schema: 1,
    id: `${kind}-${minutes}`,
    source: kind === "tool.start" ? "claude" : "herdr",
    kind,
    occurredAt: new Date(at(minutes)).toISOString(),
    recordedAt: new Date(at(minutes)).toISOString(),
    pane: "w3:p9",
    ...extra,
  };
}

const background = (minutes: number) =>
  event(minutes, "tool.start", { tool: "Bash", background: true });

describe("hasOpenBackground: a background command is open until its pane prints a result", () => {
  it("is open when a background command started and the pane has printed no result since", () => {
    expect(hasOpenBackground([background(1)], "w3:p9", at(30))).toBe(true);
  });

  it("is closed once the pane prints a result after the background command started", () => {
    expect(
      hasOpenBackground(
        [background(1), event(5, "pane.finished", { result: "done" })],
        "w3:p9",
        at(30),
      ),
    ).toBe(false);
  });

  it("is open again when a later background command starts after a result", () => {
    expect(
      hasOpenBackground(
        [
          background(1),
          event(5, "pane.finished", { result: "done" }),
          background(10),
        ],
        "w3:p9",
        at(30),
      ),
    ).toBe(true);
  });

  it("is closed when no background command ever started on the pane", () => {
    expect(
      hasOpenBackground(
        [event(1, "tool.start", { tool: "Bash" })],
        "w3:p9",
        at(30),
      ),
    ).toBe(false);
  });

  it("ignores a background command on another pane", () => {
    expect(hasOpenBackground([background(1)], "w3:p1", at(30))).toBe(false);
  });

  it("ignores a background command that started after the moment asked about", () => {
    expect(hasOpenBackground([background(40)], "w3:p9", at(30))).toBe(false);
  });
});
