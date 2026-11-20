import { describe, expect, it, vi } from "vitest";
import { HarnessCliError } from "./harness-cli.js";
import { WaitingLedger } from "./tick-ticket-waiting-ledger.js";

const NOW = "2026-11-20T10:00:00.000Z";
const KEY = "merged-pr:1234";

function ledger(over: Record<string, unknown> = {}) {
  return {
    list: vi.fn().mockResolvedValue({ events: [] }),
    record: vi.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
}

describe("WaitingLedger.sent", () => {
  it("reports a notice recorded under this key for this ticket as sent", async () => {
    const l = ledger({
      list: vi.fn().mockResolvedValue({ events: [{ label: KEY }] }),
    });

    expect(
      await new WaitingLedger(l as never, () => NOW).sent("ticket-20", KEY),
    ).toBe(true);
    expect(l.list).toHaveBeenCalledWith({
      kind: "ticket.waiting",
      idea: "ticket-20",
    });
  });

  it("reports no notice for a key recorded for another merged PR", async () => {
    const l = ledger({
      list: vi.fn().mockResolvedValue({ events: [{ label: "merged-pr:999" }] }),
    });

    expect(
      await new WaitingLedger(l as never, () => NOW).sent("ticket-20", KEY),
    ).toBe(false);
  });
});

describe("WaitingLedger.record", () => {
  it("records a ticket.waiting event labelled with the key, timed by the clock", async () => {
    const l = ledger();

    await new WaitingLedger(l as never, () => NOW).record({
      idea: "ticket-20",
      key: KEY,
    });

    expect(l.record).toHaveBeenCalledWith({
      source: "claude",
      kind: "ticket.waiting",
      occurredAt: NOW,
      idea: "ticket-20",
      label: KEY,
    });
  });

  it("throws an actionable error when the ledger rejects the event, so the notice is not counted as sent", async () => {
    const l = ledger({
      record: vi.fn().mockResolvedValue({ ok: false, message: "bad label" }),
    });

    await expect(
      new WaitingLedger(l as never, () => NOW).record({
        idea: "ticket-20",
        key: KEY,
      }),
    ).rejects.toThrow(HarnessCliError);
    await expect(
      new WaitingLedger(l as never, () => NOW).record({
        idea: "ticket-20",
        key: KEY,
      }),
    ).rejects.toThrow("bad label");
  });
});
