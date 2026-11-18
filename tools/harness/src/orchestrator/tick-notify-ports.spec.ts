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

/** A ledger whose list honours the kind and idea filters, as the real one does. */
function filteringLedger(events: Array<Record<string, unknown>>) {
  return {
    list: vi.fn(async (filter: { kind: string; idea?: string }) => ({
      events: events.filter(
        (e) =>
          e.kind === filter.kind &&
          (filter.idea === undefined || e.idea === filter.idea),
      ),
      skipped: 0,
    })),
    record: vi.fn(),
  } as unknown as Pick<Ledger, "list" | "record"> & {
    list: ReturnType<typeof vi.fn>;
  };
}

const ASKED = {
  kind: "decision.routed",
  idea: "0034",
  route: "owner",
  number: 34,
  occurredAt: "2026-11-17T09:00:00.000Z",
};

describe("NotifyLedger.openQuestions (#1058)", () => {
  it("returns an owner-routed question on the idea that no reply or reserved send has answered", async () => {
    const ledger = filteringLedger([ASKED]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([{ occurredAt: ASKED.occurredAt }]);
  });

  it("ignores a question the advisor decides, since only the owner is asked", async () => {
    const ledger = filteringLedger([{ ...ASKED, route: "advisor" }]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([]);
  });

  it("drops a question the owner has answered on its issue after it was asked", async () => {
    const ledger = filteringLedger([
      ASKED,
      {
        kind: "owner.replied",
        number: 34,
        occurredAt: "2026-11-17T09:30:00.000Z",
      },
    ]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([]);
  });

  it("keeps a question whose only reply came before it was asked", async () => {
    const ledger = filteringLedger([
      {
        kind: "owner.replied",
        number: 34,
        occurredAt: "2026-11-17T08:00:00.000Z",
      },
      ASKED,
    ]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([{ occurredAt: ASKED.occurredAt }]);
  });
});

describe("NotifyLedger.openQuestions, dedupe (#1058)", () => {
  it("drops a question once a reserved send newer than it is recorded, so a restart or the next pass repeats nothing", async () => {
    const ledger = filteringLedger([
      ASKED,
      {
        kind: "session.send",
        idea: "0034",
        label: "reserved",
        occurredAt: "2026-11-17T09:05:00.000Z",
      },
    ]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([]);
  });

  it("keeps a question asked after the last reserved send, so a new question is told", async () => {
    const ledger = filteringLedger([
      {
        kind: "session.send",
        idea: "0034",
        label: "reserved",
        occurredAt: "2026-11-17T08:00:00.000Z",
      },
      ASKED,
    ]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([{ occurredAt: ASKED.occurredAt }]);
  });

  it("reads only the questions when none is routed to the owner, so a pass without one costs one read", async () => {
    const ledger = filteringLedger([]);

    expect(
      await new NotifyLedger(ledger, () => NOW).openQuestions("0034"),
    ).toEqual([]);
    expect(ledger.list).toHaveBeenCalledTimes(1);
    expect(ledger.list).toHaveBeenCalledWith({
      kind: "decision.routed",
      idea: "0034",
    });
  });
});
