import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdeaRecord } from "../idea/index.js";
import { Approver, ApproveError, type ApprovePorts } from "./approver.js";
import { qualify } from "./qualify.js";

vi.mock("./qualify.js");

const APPROVED = "<!-- harness:auto-approved -->";
const REFUSED = "<!-- harness:left-for-person -->";
const input = { known: [], trailing: {} };
const idea = {
  number: "0007",
  issue: "215",
  harness: { metric: "metrics.tokensPerIdea" },
} as unknown as IdeaRecord;

function ports(over: Partial<ApprovePorts> = {}): ApprovePorts {
  return {
    flagOn: vi.fn().mockResolvedValue(true),
    idea: vi.fn().mockResolvedValue(idea),
    issueOf: vi.fn().mockReturnValue(215),
    metrics: vi.fn().mockResolvedValue(input),
    labels: vi.fn().mockResolvedValue([]),
    comments: vi.fn().mockResolvedValue([]),
    comment: vi.fn().mockResolvedValue(undefined),
    label: vi.fn().mockResolvedValue(undefined),
    ledger: {
      list: vi.fn().mockResolvedValue({ events: [] }),
      record: vi.fn().mockResolvedValue({ ok: true }),
    },
    clock: { now: () => new Date("2026-11-15T01:02:03.456Z") },
    ...over,
  } as ApprovePorts;
}

const qualifies = { approve: true, reason: "Auto-approved: because." };
const refused = { approve: false, reason: "Left for a person: because." };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(qualify).mockReturnValue(qualifies);
});

describe("Approver", () => {
  it("labels a qualifying idea, posts the reason first, and records the event once", async () => {
    const p = ports();
    const result = await new Approver(p).run("7");

    expect(result).toEqual({
      idea: "0007",
      issue: 215,
      status: "approved",
      reason: "Auto-approved: because.",
    });
    expect(p.comment).toHaveBeenCalledWith(
      215,
      `${APPROVED}\nAuto-approved: because.`,
    );
    expect(p.label).toHaveBeenCalledWith(215);
    expect(p.ledger.record).toHaveBeenCalledWith({
      source: "claude",
      kind: "auto-approved",
      occurredAt: "2026-11-15T01:02:03.456Z",
      idea: "#215",
      number: 215,
      label: "metrics.tokensPerIdea",
    });
    const order = [
      vi.mocked(p.comment).mock.invocationCallOrder[0],
      vi.mocked(p.label).mock.invocationCallOrder[0],
      vi.mocked(p.ledger.record).mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("applies no label and records no event when the idea does not qualify, but still posts the reason", async () => {
    vi.mocked(qualify).mockReturnValue(refused);
    const p = ports();

    const result = await new Approver(p).run("7");

    expect(result.status).toBe("left-for-person");
    expect(p.label).not.toHaveBeenCalled();
    expect(p.ledger.record).not.toHaveBeenCalled();
    expect(p.comment).toHaveBeenCalledWith(
      215,
      `${REFUSED}\nLeft for a person: because.`,
    );
  });

  it("applies nothing when the flag is off: no label, no comment, no event", async () => {
    const p = ports({ flagOn: vi.fn().mockResolvedValue(false) });

    const result = await new Approver(p).run("7");

    expect(result).toEqual({
      idea: "0007",
      issue: 215,
      status: "flag-off",
      reason: "Auto-approved: because.",
    });
    expect(p.label).not.toHaveBeenCalled();
    expect(p.comment).not.toHaveBeenCalled();
    expect(p.ledger.record).not.toHaveBeenCalled();
  });
});

describe("Approver reruns", () => {
  it("changes nothing on a rerun: no second label, comment or event", async () => {
    const p = ports({
      labels: vi.fn().mockResolvedValue(["ready-for-agent"]),
      comments: vi
        .fn()
        .mockResolvedValue([`${APPROVED}\nAuto-approved: because.`]),
      ledger: {
        list: vi.fn().mockResolvedValue({ events: [{ number: 215 }] }),
        record: vi.fn(),
      },
    });

    const result = await new Approver(p).run("7");

    expect(result.status).toBe("already-approved");
    expect(p.label).not.toHaveBeenCalled();
    expect(p.comment).not.toHaveBeenCalled();
    expect(p.ledger.record).not.toHaveBeenCalled();
  });

  it("records the missing event on a rerun after a crash between label and event", async () => {
    const p = ports({
      labels: vi.fn().mockResolvedValue(["ready-for-agent"]),
      comments: vi
        .fn()
        .mockResolvedValue([`${APPROVED}\nAuto-approved: because.`]),
    });

    await new Approver(p).run("7");

    expect(p.label).not.toHaveBeenCalled();
    expect(p.comment).not.toHaveBeenCalled();
    expect(p.ledger.record).toHaveBeenCalledOnce();
  });

  it("does not claim a person's label as its own: no event, no comment", async () => {
    const p = ports({
      labels: vi.fn().mockResolvedValue(["ready-for-agent"]),
    });

    const result = await new Approver(p).run("7");

    expect(result.status).toBe("already-approved");
    expect(p.ledger.record).not.toHaveBeenCalled();
    expect(p.comment).not.toHaveBeenCalled();
  });

  it("does not repeat a refusal comment already on the issue", async () => {
    vi.mocked(qualify).mockReturnValue(refused);
    const p = ports({
      comments: vi
        .fn()
        .mockResolvedValue([`${REFUSED}\nLeft for a person: because.`]),
    });

    await new Approver(p).run("7");

    expect(p.comment).not.toHaveBeenCalled();
    expect(p.label).not.toHaveBeenCalled();
  });
});

describe("Approver failures", () => {
  it("refuses an idea with no issue, naming the fix, and writes nothing", async () => {
    const p = ports({
      issueOf: vi.fn().mockReturnValue(undefined),
    });

    await expect(new Approver(p).run("7")).rejects.toThrow(
      new ApproveError(
        "Idea 0007 has no issue to label or comment on; run `harness idea sync --idea 0007` first, then rerun.",
      ),
    );
    expect(p.label).not.toHaveBeenCalled();
    expect(p.ledger.record).not.toHaveBeenCalled();
  });

  it("fails naming the fix when the event is rejected, so the rerun can finish", async () => {
    const p = ports({
      ledger: {
        list: vi.fn().mockResolvedValue({ events: [] }),
        record: vi.fn().mockResolvedValue({ ok: false, message: "bad." }),
      },
    });

    await expect(new Approver(p).run("7")).rejects.toThrow(
      "The auto-approved event was rejected: bad. Fix the ledger, then rerun `harness approve --idea 7`.",
    );
  });
});
