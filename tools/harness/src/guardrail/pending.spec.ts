// The pending-requests unit: which guardrails still wait for a person's approval.
// Pure over plain events and an inventory.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { describe, expect, it } from "vitest";
import type { Inventory } from "./inventory.js";
import { pendingRequests } from "./pending.js";

const inventory = (mode: "audit" | "enforce"): Inventory => ({
  guardrails: [{ rule: "bare-glob", kind: "bash", mode, owner: "o" }],
});
const event = (label: string, idea = "0223") => ({ label, idea });

describe("pendingRequests", () => {
  it("lists a request whose rule still has the mode it was asked to leave", () => {
    expect(
      pendingRequests([event("bare-glob:audit>enforce")], inventory("audit")),
    ).toEqual([
      { rule: "bare-glob", from: "audit", to: "enforce", idea: "0223" },
    ]);
  });

  it("drops a request once the rule has the requested mode", () => {
    expect(
      pendingRequests([event("bare-glob:audit>enforce")], inventory("enforce")),
    ).toEqual([]);
  });

  it("drops a request the rule's mode has moved past without it", () => {
    expect(
      pendingRequests([event("bare-glob:enforce>audit")], inventory("audit")),
    ).toEqual([]);
  });

  it("keeps a removal pending while the rule is in the inventory and drops it once the rule is gone", () => {
    const removal = [event("bare-glob:audit>removed")];
    expect(pendingRequests(removal, inventory("audit"))).toHaveLength(1);
    expect(pendingRequests(removal, { guardrails: [] })).toEqual([]);
  });

  it("keeps only the latest request for a rule", () => {
    expect(
      pendingRequests(
        [
          event("bare-glob:audit>removed", "0001"),
          event("bare-glob:audit>enforce", "0002"),
        ],
        inventory("audit"),
      ),
    ).toEqual([
      { rule: "bare-glob", from: "audit", to: "enforce", idea: "0002" },
    ]);
  });

  it("ignores an event whose label is not a request or has no idea", () => {
    expect(
      pendingRequests(
        [{ label: "garbage" }, { label: "bare-glob:audit>enforce" }, {}],
        inventory("audit"),
      ),
    ).toEqual([]);
  });
});
