import { describe, expect, it, vi } from "vitest";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import { BranchLedger } from "./tick-branch-ledger.js";

const KEY = "branch-notice:1234:abc1234:9988776";
const WRITER = "idea-0034-writer-abc1234";
const NOW = "2026-11-17T10:00:00.000Z";

function event(over: Partial<LedgerEvent>): LedgerEvent {
  return {
    source: "claude",
    kind: "session.send",
    occurredAt: NOW,
    idea: "0034",
    label: KEY,
    ...over,
  } as LedgerEvent;
}

function ledger(events: LedgerEvent[] = []) {
  // Like the real ledger, a list filtered by idea returns only that idea's events.
  const list = vi.fn(async (query: { idea?: string }) => ({
    events: events.filter(
      (e) => query.idea === undefined || e.idea === query.idea,
    ),
  }));
  const record = vi.fn().mockResolvedValue({ ok: true });
  return {
    ledger: { list, record } as unknown as Pick<Ledger, "list" | "record">,
    list,
    record,
  };
}

describe("BranchLedger.sent", () => {
  it("is true once a notice with the same key was recorded for the idea", async () => {
    const { ledger: l, list } = ledger([event({})]);

    expect(await new BranchLedger(l, () => NOW).sent("0034", KEY)).toBe(true);
    expect(list).toHaveBeenCalledWith({ kind: "session.send", idea: "0034" });
  });

  it("is false for a notice under another key, so a changed head is sent again", async () => {
    const { ledger: l } = ledger([
      event({ label: "branch-notice:1234:abc1234:1111111" }),
    ]);

    expect(await new BranchLedger(l, () => NOW).sent("0034", KEY)).toBe(false);
  });

  it("is false for a notice on another idea, and for a plain session send that carries no key", async () => {
    const plainSend = {
      source: "herdr",
      kind: "session.send",
      occurredAt: NOW,
      idea: "0034",
      agent: WRITER,
    } as LedgerEvent;
    const { ledger: l } = ledger([event({ idea: "0035" }), plainSend]);

    expect(await new BranchLedger(l, () => NOW).sent("0034", KEY)).toBe(false);
  });
});

describe("BranchLedger.record", () => {
  it("records a session.send under the idea, its key, the writer and the tick as sender", async () => {
    const { ledger: l, record } = ledger();

    await new BranchLedger(l, () => NOW).record({
      idea: "0034",
      key: KEY,
      writer: WRITER,
    });

    expect(record).toHaveBeenCalledWith({
      source: "claude",
      kind: "session.send",
      occurredAt: NOW,
      agent: WRITER,
      idea: "0034",
      label: KEY,
      senderRole: "tick",
      senderName: "orchestrator-tick",
    });
  });

  it("refuses to pass a rejected ledger write on, so the next pass does not read a notice that was never kept", async () => {
    const { ledger: l, record } = ledger();
    record.mockResolvedValue({ ok: false, message: "label is too long" });

    await expect(
      new BranchLedger(l, () => NOW).record({
        idea: "0034",
        key: KEY,
        writer: WRITER,
      }),
    ).rejects.toThrow("label is too long");
  });
});
