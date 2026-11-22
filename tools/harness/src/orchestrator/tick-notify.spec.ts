import { describe, expect, it, vi } from "vitest";
import type { IdeaStep } from "./tick.js";
import {
  NEEDS_A_PERSON,
  TickNotifier,
  needsAPerson,
  type NotifyPorts,
} from "./tick-notify.js";

const TICK_ENV = { KORE_ROLE: "tick", KORE_AGENT: "orchestrator-tick" };
const COMMAND = "orchestrate tick";
const PANE = "w3:p1";

function ports(over: Partial<NotifyPorts> = {}): NotifyPorts {
  return {
    attendedPane: vi.fn().mockResolvedValue(PANE),
    sent: vi.fn().mockResolvedValue(false),
    openQuestions: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const step = (name: IdeaStep["step"]): IdeaStep => ({
  idea: "0034",
  issue: 34,
  step: name,
});

describe("NEEDS_A_PERSON", () => {
  it("holds exactly the ends that need a person: blocked, needs-judgment, needs-info and reserved", () => {
    expect([...NEEDS_A_PERSON]).toEqual([
      "blocked",
      "needs-judgment",
      "needs-info",
      "reserved",
    ]);
  });

  it("leaves awaiting-judge out, since a judge pane is a wait and not a person", () => {
    expect(needsAPerson("awaiting-judge")).toBe(false);
  });

  it("leaves a step that is not an end out, so a working idea notifies nobody", () => {
    expect(needsAPerson("waiting")).toBe(false);
    expect(needsAPerson("spawn-writer")).toBe(false);
  });
});

describe("TickNotifier.notify", () => {
  it("sends one signed line naming the idea and the reason, and records the send", async () => {
    const p = ports();
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("needs-info"));

    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send).toHaveBeenCalledWith(
      PANE,
      "sender: tick orchestrator-tick (orchestrate tick): Idea 0034 needs a person: the judgment flow stopped it and labelled the idea needs-info; the owner decides.",
    );
    expect(p.record).toHaveBeenCalledWith({
      idea: "0034",
      state: "needs-info",
      pane: PANE,
      sender: {
        command: COMMAND,
        session: { role: "tick", name: "orchestrator-tick" },
      },
    });
  });

  it.each([
    [
      "blocked",
      "a pane ended blocked, or a writer left no pull request; the owner decides",
    ],
    [
      "needs-judgment",
      "a third send-back went to a judgment pane that already ran; the owner decides",
    ],
  ] as const)(
    "names the reason for a %s idea in its message",
    async (state, reason) => {
      const p = ports();
      await new TickNotifier(p, TICK_ENV, COMMAND).notify(step(state));

      expect(p.send).toHaveBeenCalledWith(
        PANE,
        `sender: tick orchestrator-tick (orchestrate tick): Idea 0034 needs a person: ${reason}.`,
      );
    },
  );

  it("sends nothing for a step that needs no person, and reads no pane", async () => {
    const p = ports();
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("awaiting-judge"));

    expect(p.attendedPane).not.toHaveBeenCalled();
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("sends nothing when this idea and state were already sent, so a rerun or restart repeats nothing", async () => {
    const p = ports({ sent: vi.fn().mockResolvedValue(true) });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("blocked"));

    expect(p.sent).toHaveBeenCalledWith("0034", "blocked");
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("sends nothing when the idea has no attended pane recorded", async () => {
    const p = ports({ attendedPane: vi.fn().mockResolvedValue(undefined) });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("needs-info"));

    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("records nothing when delivery fails, so the next pass tries again", async () => {
    const p = ports({
      send: vi.fn().mockResolvedValue("herdr pane send-text failed"),
    });
    await expect(
      new TickNotifier(p, TICK_ENV, COMMAND).notify(step("blocked")),
    ).rejects.toThrow("herdr pane send-text failed");

    expect(p.record).not.toHaveBeenCalled();
  });
});

describe("TickNotifier.notify for a reserved question (#1058)", () => {
  const OPEN = [{ occurredAt: "2026-11-17T09:00:00.000Z" }];
  const REASON =
    "a reserved question waits on the owner's reply on the idea's issue; the owner decides";

  it("tells the attended pane once when a reserved question is open, on a step that needs no person", async () => {
    const p = ports({ openQuestions: vi.fn().mockResolvedValue(OPEN) });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("waiting"));

    expect(p.openQuestions).toHaveBeenCalledWith("0034");
    expect(p.send).toHaveBeenCalledTimes(1);
    expect(p.send).toHaveBeenCalledWith(
      PANE,
      `sender: tick orchestrator-tick (orchestrate tick): Idea 0034 needs a person: ${REASON}.`,
    );
    expect(p.record).toHaveBeenCalledWith({
      idea: "0034",
      state: "reserved",
      pane: PANE,
      sender: {
        command: COMMAND,
        session: { role: "tick", name: "orchestrator-tick" },
      },
    });
  });

  it("checks for an open question on every step, and sends nothing when none is open", async () => {
    const p = ports();
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("awaiting-judge"));

    expect(p.openQuestions).toHaveBeenCalledWith("0034");
    expect(p.attendedPane).not.toHaveBeenCalled();
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("sends nothing for a question when the idea has no attended pane recorded", async () => {
    const p = ports({
      openQuestions: vi.fn().mockResolvedValue(OPEN),
      attendedPane: vi.fn().mockResolvedValue(undefined),
    });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("waiting"));

    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });

  it("records nothing when delivering the reserved line fails, so the next pass tries again", async () => {
    const p = ports({
      openQuestions: vi.fn().mockResolvedValue(OPEN),
      send: vi.fn().mockResolvedValue("herdr pane send-text failed"),
    });
    await expect(
      new TickNotifier(p, TICK_ENV, COMMAND).notify(step("waiting")),
    ).rejects.toThrow("herdr pane send-text failed");

    expect(p.record).not.toHaveBeenCalled();
  });

  it("sends a blocked idea's line and its reserved line separately, each recorded once", async () => {
    const p = ports({ openQuestions: vi.fn().mockResolvedValue(OPEN) });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("blocked"));

    expect(p.send).toHaveBeenCalledTimes(2);
    expect(p.record).toHaveBeenCalledTimes(2);
    expect(p.record).toHaveBeenCalledWith(
      expect.objectContaining({ state: "blocked" }),
    );
    expect(p.record).toHaveBeenCalledWith(
      expect.objectContaining({ state: "reserved" }),
    );
  });
});

describe("TickNotifier.notify for a relabelled attended terminal", () => {
  it("tells nobody twice: an idea and state already sent are not sent again to the terminal now labelled", async () => {
    const p = ports({
      attendedPane: vi.fn().mockResolvedValue("t10"),
      sent: vi.fn().mockResolvedValue(true),
    });
    await new TickNotifier(p, TICK_ENV, COMMAND).notify(step("needs-info"));

    expect(p.sent).toHaveBeenCalledWith("0034", "needs-info");
    expect(p.send).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
  });
});
