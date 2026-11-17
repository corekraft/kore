import { describe, expect, it, vi } from "vitest";
import type { Ledger } from "../ledger/index.js";
import { HarnessCliError } from "./harness-cli.js";
import { NotifyLedger } from "./tick-notify-ports.js";

const NOW = "2026-11-17T10:00:00.000Z";
const SENDER = {
  command: "orchestrate tick",
  session: { role: "tick", name: "orchestrator-tick" },
};

function ledgerWith(
  events: object[] = [],
  written: { ok: boolean; message?: string } = { ok: true },
): Pick<Ledger, "list" | "record"> {
  return {
    list: vi.fn().mockResolvedValue({ events, skipped: 0 }),
    record: vi
      .fn()
      .mockResolvedValue(
        written.ok
          ? { ok: true, event: {} }
          : { ok: false, field: "label", message: written.message },
      ),
  } as unknown as Pick<Ledger, "list" | "record">;
}

describe("NotifyLedger.sent", () => {
  it("reads the idea's session sends and is true once one carries this state as its label", async () => {
    const ledger = ledgerWith([
      { kind: "session.send", idea: "0034", label: "needs-info" },
    ]);
    const sent = await new NotifyLedger(ledger, () => NOW).sent(
      "0034",
      "needs-info",
    );

    expect(ledger.list).toHaveBeenCalledWith({
      kind: "session.send",
      idea: "0034",
    });
    expect(sent).toBe(true);
  });

  it("is false for another state of the same idea, so each state is told once", async () => {
    const ledger = ledgerWith([
      { kind: "session.send", idea: "0034", label: "blocked" },
    ]);

    expect(
      await new NotifyLedger(ledger, () => NOW).sent("0034", "needs-info"),
    ).toBe(false);
  });

  it("is false when the idea has no session send yet", async () => {
    expect(
      await new NotifyLedger(ledgerWith(), () => NOW).sent("0034", "blocked"),
    ).toBe(false);
  });
});

describe("NotifyLedger.record", () => {
  it("records the send with its idea, state, pane and the tick as sender", async () => {
    const ledger = ledgerWith();
    await new NotifyLedger(ledger, () => NOW).record({
      idea: "0034",
      state: "needs-info",
      pane: "w3:p1",
      sender: SENDER,
    });

    expect(ledger.record).toHaveBeenCalledWith({
      source: "claude",
      kind: "session.send",
      occurredAt: NOW,
      pane: "w3:p1",
      idea: "0034",
      label: "needs-info",
      senderRole: "tick",
      senderName: "orchestrator-tick",
    });
  });

  it("throws the ledger's reason when the send cannot be recorded, so the next pass tries again", async () => {
    const ledger = ledgerWith([], { ok: false, message: "label is too long" });

    await expect(
      new NotifyLedger(ledger, () => NOW).record({
        idea: "0034",
        state: "needs-info",
        pane: "w3:p1",
        sender: SENDER,
      }),
    ).rejects.toThrow(new HarnessCliError("label is too long"));
  });
});
