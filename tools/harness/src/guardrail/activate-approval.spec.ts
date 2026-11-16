// What counts as a person's approval, and what a refusal leaves behind.
// Every port, the inventory parser and the text edits are mocks.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalLine, type IssueComment } from "./activate.js";
import {
  approved,
  fake,
  GUARDRAILS,
  LATER,
  person,
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
const refused = async (
  comments: (label: string) => IssueComment[],
  labels: string[] = [],
) => {
  const f = fake(target, comments, "enforce", labels);
  const result = await f.activate.activate({
    rule: target.rule,
    to: "enforce",
  });
  return { f, result };
};
const request = (label: string): IssueComment => ({
  author: "claude",
  createdAt: REQUEST_AT,
  body: requestBody(label),
});

describe("what counts as a person's approval", () => {
  it("never counts an agent-applied label, and says so", async () => {
    const { f, result } = await refused(
      (label) => [request(label)],
      ["approved", "ready-for-agent"],
    );
    expect(result.activated).toBe(false);
    expect(result.reason).toBe(
      "A label is not an approval: the idea's issue carries the label approved, but only a comment from junners with the line `approve bare-glob:audit>enforce` counts.",
    );
    expect(f.writeInventory).not.toHaveBeenCalled();
  });

  it("does not count the approval line from someone who is not a named approver", async () => {
    const { f, result } = await refused((label) => [
      request(label),
      person(label, LATER, "some-agent"),
    ]);
    expect(result.activated).toBe(false);
    expect(f.writeInventory).not.toHaveBeenCalled();
  });

  it("does not count a comment that carries a harness marker, even from an approver's login", async () => {
    const { result } = await refused((label) => [
      request(label),
      {
        ...person(label),
        body: `<!-- harness-marker idea=0224 -->\n${approvalLine(label)}`,
      },
    ]);
    expect(result.activated).toBe(false);
  });

  it("does not count an approval made before the request", async () => {
    const { result } = await refused((label) => [
      person(label, "2026-11-14T09:00:00Z"),
      request(label),
    ]);
    expect(result.activated).toBe(false);
  });

  it("does not count an approval of another change", async () => {
    const { result } = await refused((label) => [
      request(label),
      person("bare-glob:audit>removed"),
    ]);
    expect(result.activated).toBe(false);
  });

  it("refuses when no request was recorded, naming the request command", async () => {
    const f = fake(target, approved);
    f.events.mockResolvedValue([]);
    const result = await f.activate.activate({
      rule: target.rule,
      to: "enforce",
    });
    expect(result.activated).toBe(false);
    expect(result.reason).toBe(
      "No request is on record for bare-glob:audit>enforce. Run `harness guardrail request bare-glob --to enforce --idea 0224 ...` first, then ask a person to approve.",
    );
    expect(f.writeInventory).not.toHaveBeenCalled();
  });
});
