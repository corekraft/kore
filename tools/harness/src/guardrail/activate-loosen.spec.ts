// Loosening, removing and unrunnable commands.
// Every port, the inventory parser and the text edits are mocks.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GuardrailActivate } from "./activate.js";
import {
  approved,
  enforced,
  fake,
  GUARDRAILS,
  IDEA,
  REQUEST_AT,
  requestBody,
} from "./activate-support.js";
import { withMode, withoutRule } from "./edit.js";
import { GuardrailError, parseInventory, type Guardrail } from "./inventory.js";

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

describe("loosening and removing", () => {
  it("loosens an enforced guardrail only with approval of that change", async () => {
    const f = fake(enforced, approved, "audit");
    const result = await f.activate.activate({
      rule: "no-verify",
      to: "audit",
    });
    expect(result).toMatchObject({
      from: "enforce",
      to: "audit",
      activated: true,
    });
    expect(withMode).toHaveBeenCalledWith("INVENTORY", "no-verify", "audit");
  });

  it("refuses to loosen without approval and keeps the mode", async () => {
    const f = fake(
      enforced,
      (label) => [
        { author: "claude", createdAt: REQUEST_AT, body: requestBody(label) },
      ],
      "audit",
    );
    const result = await f.activate.activate({
      rule: "no-verify",
      to: "audit",
    });
    expect(result.activated).toBe(false);
    expect(f.writeInventory).not.toHaveBeenCalled();
  });

  it("removes a guardrail's entry only with approval", async () => {
    const f = fake(enforced, approved, "removed");
    const result = await f.activate.activate({
      rule: "no-verify",
      to: "removed",
    });
    expect(result.activated).toBe(true);
    expect(withoutRule).toHaveBeenCalledWith("INVENTORY", "no-verify");
    expect(f.writeInventory).toHaveBeenCalledWith("REMOVED");
  });

  it("refuses to remove without approval and keeps the entry", async () => {
    const f = fake(
      enforced,
      (label) => [
        { author: "claude", createdAt: REQUEST_AT, body: requestBody(label) },
      ],
      "removed",
    );
    const result = await f.activate.activate({
      rule: "no-verify",
      to: "removed",
    });
    expect(result.activated).toBe(false);
    expect(f.writeInventory).not.toHaveBeenCalled();
    expect(f.recordEvent).not.toHaveBeenCalled();
  });

  it("regenerates the deny list for a deny rule that is removed", async () => {
    const denied = {
      ...(GUARDRAILS["deny"] as Guardrail),
      mode: "enforce" as const,
    };
    const f = fake(denied, approved, "removed");
    await f.activate.activate({ rule: "deny-x", to: "removed" });
    expect(f.syncDeny).toHaveBeenCalledTimes(1);
  });
});

describe("a command that cannot be run", () => {
  const target = GUARDRAILS["guard"] as Guardrail;

  it.each([
    ["an unknown rule", "nope", "enforce", /No guardrail "nope"/],
    ["an unknown target", "bare-glob", "warn", /Unknown target "warn"/],
    ["the mode it already has", "bare-glob", "audit", /already in audit mode/],
  ])(
    "is refused for %s, with nothing written or posted",
    async (_n, rule, to, message) => {
      const f = fake(target, approved);
      await expect(f.activate.activate({ rule, to })).rejects.toThrow(message);
      expect(f.writeInventory).not.toHaveBeenCalled();
      expect(f.commentOn).not.toHaveBeenCalled();
    },
  );

  it("is refused when the idea has no issue", async () => {
    const f = fake(target, approved);
    const { issue: _issue, ...ports } = IDEA;
    const activate = new GuardrailActivate({
      inventory: { guardrails: [target] },
      inventoryText: "X",
      idea: ports,
      approvers: ["junners"],
      events: f.events,
      comments: vi.fn(),
      labels: vi.fn(),
      comment: f.commentOn,
      writeInventory: f.writeInventory,
      syncDeny: f.syncDeny,
      recordEvent: f.recordEvent,
      recordWarning: f.recordWarning,
    });
    await expect(
      activate.activate({ rule: "bare-glob", to: "enforce" }),
    ).rejects.toThrow(GuardrailError);
  });

  it("says what to rerun when the ledger rejects the event after the mode changed", async () => {
    const f = fake(target, approved);
    f.recordEvent.mockResolvedValue({ ok: false, message: "bad ledger" });
    await expect(
      f.activate.activate({ rule: "bare-glob", to: "enforce" }),
    ).rejects.toThrow(
      "bare-glob is now in enforce mode, but its ledger event was rejected: bad ledger. Record it with `harness ledger record --kind guardrail.activated --label bare-glob:audit>enforce --idea 0224`.",
    );
  });
});
