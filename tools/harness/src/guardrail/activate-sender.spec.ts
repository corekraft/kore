// An approving comment that carries a sender line: the change still goes ahead, with a warning
// that names the comment and a ledger event for it. Refusing is the owner's decision, not this gate's.
// Every port, the inventory parser and the text edits are mocks.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalLine, type IssueComment } from "./activate.js";
import {
  fake,
  GUARDRAILS,
  LATER,
  REQUEST_AT,
  requestBody,
} from "./activate-support.js";
import { parseInventory, type Guardrail } from "./inventory.js";
import { withMode, withoutRule } from "./edit.js";

vi.mock("./edit.js");
vi.mock("./request.js", () => ({
  marker: (label: string) => `<!-- guardrail-request: ${label} -->`,
  requestLabel: (rule: string, from: string, to: string) =>
    `${rule}:${from}>${to}`,
}));
vi.mock("./inventory.js", async (original) => ({
  ...(await original<typeof import("./inventory.js")>()),
  parseInventory: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(withMode).mockReturnValue("EDITED");
  vi.mocked(withoutRule).mockReturnValue("REMOVED");
  vi.mocked(parseInventory).mockReturnValue({ guardrails: [] });
});

const target = GUARDRAILS["guard"] as Guardrail;
const LABEL = "bare-glob:audit>enforce";
const URL = "https://github.com/corekraft/kore/issues/224#issuecomment-9";
const SENDER = "sender: writer fix-x (review post)";

const request = (label: string): IssueComment => ({
  author: "claude",
  createdAt: REQUEST_AT,
  body: requestBody(label),
});
const tagged = (
  label: string,
  body = `${SENDER}\n${approvalLine(label)}`,
): IssueComment => ({
  author: "junners",
  createdAt: LATER,
  url: URL,
  body,
});
const untagged = (label: string): IssueComment => ({
  author: "junners",
  createdAt: "2026-11-14T10:30:00Z",
  body: `Looks right.\n${approvalLine(label)}\n`,
});

describe("an approval that carries a sender line", () => {
  it("still activates the change, as the gate does today", async () => {
    const f = fake(target, (label) => [request(label), tagged(label)]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.activated).toBe(true);
    expect(f.writeInventory).toHaveBeenCalledWith("EDITED");
    expect(f.recordEvent).toHaveBeenCalledWith(LABEL, "0224");
  });

  it("warns, naming the comment and why it is not the owner's", async () => {
    const f = fake(target, (label) => [request(label), tagged(label)]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.warning).toBe(
      `The approval for ${LABEL} is the comment ${URL}, posted by writer fix-x (review post) with a sender line, so it is not the owner's. The gate still accepts it; whether to refuse it is the owner's decision.`,
    );
  });

  it("names the comment by its author and time when the comment has no URL", async () => {
    const f = fake(target, (label) => [
      request(label),
      {
        author: "junners",
        createdAt: LATER,
        body: `${SENDER}\n${approvalLine(label)}`,
      },
    ]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.warning).toBe(
      `The approval for ${LABEL} is the comment by junners at ${LATER}, posted by writer fix-x (review post) with a sender line, so it is not the owner's. The gate still accepts it; whether to refuse it is the owner's decision.`,
    );
  });

  it("names the main session when the line names no session", async () => {
    const f = fake(target, (label) => [
      request(label),
      tagged(
        label,
        `sender: the main session (guardrail request)\n${approvalLine(label)}`,
      ),
    ]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.warning).toContain(
      "posted by the main session (guardrail request) with a sender line",
    );
  });
});

describe("what a tagged approval leaves on record", () => {
  it("records a guardrail.approval-warned event for the change and its idea", async () => {
    const f = fake(target, (label) => [request(label), tagged(label)]);
    await f.activate.activate({ rule: target.rule, to: "enforce" });
    expect(f.recordWarning.mock.calls).toEqual([[LABEL, "0224"]]);
  });
});

describe("when no warning is due", () => {
  it("does not warn when a person's untagged approval is also on the issue", async () => {
    const f = fake(target, (label) => [
      request(label),
      tagged(label),
      untagged(label),
    ]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.activated).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(f.recordWarning).not.toHaveBeenCalled();
  });

  it("does not warn on an untagged approval", async () => {
    const f = fake(target, (label) => [request(label), untagged(label)]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.activated).toBe(true);
    expect(result).not.toHaveProperty("warning");
    expect(f.recordWarning).not.toHaveBeenCalled();
  });

  it("writes nothing when the warning cannot be recorded, so the change is not made half-way", async () => {
    const f = fake(target, (label) => [request(label), tagged(label)]);
    f.recordWarning.mockResolvedValue({ ok: false, message: "bad label" });
    await expect(
      f.activate.activate({ rule: target.rule, to: "enforce" }),
    ).rejects.toThrow(
      `The sender-line warning for ${LABEL} could not be recorded: bad label. Record it with \`harness ledger record --kind guardrail.approval-warned --label ${LABEL} --idea 0224\`, then rerun.`,
    );
    expect(f.writeInventory).not.toHaveBeenCalled();
    expect(f.recordEvent).not.toHaveBeenCalled();
  });

  it("records no warning when the approval is refused", async () => {
    const f = fake(target, (label) => [
      request(label),
      tagged(label, `${SENDER}\nLooks right, not approved.`),
    ]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.activated).toBe(false);
    expect(result).not.toHaveProperty("warning");
    expect(f.recordWarning).not.toHaveBeenCalled();
    expect(f.writeInventory).not.toHaveBeenCalled();
  });
});
