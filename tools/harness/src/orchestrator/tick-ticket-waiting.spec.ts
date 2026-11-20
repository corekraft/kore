import { describe, expect, it, vi } from "vitest";
import type { IdeaStep } from "./tick-step.js";
import {
  WaitingStepNotifier,
  WaitingTicketNotice,
  waitingBody,
  waitingKey,
  type WaitingPorts,
} from "./tick-ticket-waiting.js";

const TICKET = "ticket-20";
const ISSUE = 20;
const PR = 1234;
const KEY = "merged-pr:1234";
const SENDER_LINE = "sender: tick orchestrator-tick (orchestrate tick)";

function ports(over: Partial<WaitingPorts> = {}): WaitingPorts {
  return {
    sent: vi.fn().mockResolvedValue(false),
    comment: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const merged = (over: Partial<IdeaStep> = {}): IdeaStep => ({
  idea: TICKET,
  issue: ISSUE,
  step: "merged",
  pr: PR,
  ...over,
});

describe("waitingKey", () => {
  it("names the merged PR, so each merged PR on a ticket is noticed once", () => {
    expect(waitingKey(PR)).toBe(KEY);
    expect(waitingKey(PR)).not.toBe(waitingKey(PR + 1));
  });
});

describe("waitingBody", () => {
  it("opens with the sender line and says the change merged and what the ticket waits on", () => {
    const body = waitingBody(SENDER_LINE, PR, ISSUE);
    expect(body.split("\n")[0]).toBe(SENDER_LINE);
    expect(body).toContain(`PR #${PR} merged`);
    expect(body).toContain("live proof");
    expect(body).toContain("owner step");
    expect(body).toContain("`live-proof`");
    expect(body).toContain("assignee");
    expect(body).toContain("close");
  });
});

describe("WaitingTicketNotice.check", () => {
  it("posts one comment on the ticket, signed by the tick, and records it under the merged PR", async () => {
    const p = ports();

    const report = await new WaitingTicketNotice(p).check(merged());

    expect(p.comment).toHaveBeenCalledTimes(1);
    expect(p.comment).toHaveBeenCalledWith(
      ISSUE,
      waitingBody(SENDER_LINE, PR, ISSUE),
    );
    expect(p.record).toHaveBeenCalledWith({ idea: TICKET, key: KEY });
    expect(report).toContain(`#${ISSUE}`);
    expect(report).toContain(`PR #${PR}`);
  });

  it("never signs the comment as the owner or the main session", async () => {
    const p = ports();

    await new WaitingTicketNotice(p).check(merged());

    const [, body] = vi.mocked(p.comment).mock.calls[0] ?? [];
    expect(body).not.toContain("the main session");
  });

  it("posts nothing for a merged PR the ledger already has a notice for, so a rerun posts nothing twice", async () => {
    const p = ports({ sent: vi.fn().mockResolvedValue(true) });

    const report = await new WaitingTicketNotice(p).check(merged());

    expect(p.sent).toHaveBeenCalledWith(TICKET, KEY);
    expect(p.comment).not.toHaveBeenCalled();
    expect(p.record).not.toHaveBeenCalled();
    expect(report).toBeUndefined();
  });

  it("reports the failure and records nothing when the comment cannot be posted, so the next pass tries again", async () => {
    const p = ports({ comment: vi.fn().mockResolvedValue("gh: HTTP 502") });

    const report = await new WaitingTicketNotice(p).check(merged());

    expect(report).toContain("not posted");
    expect(report).toContain("HTTP 502");
    expect(p.record).not.toHaveBeenCalled();
  });

  it("leaves steps that are not a merged ticket alone", async () => {
    const p = ports();
    const notice = new WaitingTicketNotice(p);

    expect(
      await notice.check(merged({ step: "awaiting-outcome" })),
    ).toBeUndefined();
    expect(await notice.check(merged({ idea: "0034" }))).toBeUndefined();
    expect(p.comment).not.toHaveBeenCalled();
  });
});

describe("WaitingStepNotifier", () => {
  it("runs the step's own notice first, then sets the step's notice from the waiting check", async () => {
    const inner = vi.fn().mockResolvedValue(undefined);
    const notifier = new WaitingStepNotifier(
      { notify: inner },
      new WaitingTicketNotice(ports()),
    );
    const step = merged();

    await notifier.notify(step);

    expect(inner).toHaveBeenCalledWith(step);
    expect(step.notice).toContain(`#${ISSUE}`);
  });

  it("keeps a notice the step already carries, and adds the waiting report after it", async () => {
    const notifier = new WaitingStepNotifier(
      {
        notify: vi.fn().mockImplementation(async (s: IdeaStep) => {
          s.notice = "Branch update notice sent.";
        }),
      },
      new WaitingTicketNotice(ports()),
    );
    const step = merged();

    await notifier.notify(step);

    expect(step.notice?.split("\n")[0]).toBe("Branch update notice sent.");
    expect(step.notice).toContain(`#${ISSUE}`);
  });

  it("leaves the step's notice unset when there is nothing to say", async () => {
    const notifier = new WaitingStepNotifier(
      { notify: vi.fn().mockResolvedValue(undefined) },
      new WaitingTicketNotice(ports()),
    );
    const step = merged({ step: "awaiting-outcome" });

    await notifier.notify(step);

    expect(step.notice).toBeUndefined();
  });
});
