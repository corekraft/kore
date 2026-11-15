// Activation by kind: every kind of guardrail flips with a person's approval and stays put without one.
// Every port, the inventory parser and the text edits are mocks.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  approved,
  fake,
  GUARDRAILS,
  REQUEST_AT,
  requestBody,
} from "./activate-support.js";
import { withMode, withoutRule } from "./edit.js";
import { parseInventory } from "./inventory.js";

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

describe.each(Object.entries(GUARDRAILS))(
  "activating a %s guardrail",
  (_name, target) => {
    it("flips the mode and records the event with a person's approval", async () => {
      const f = fake(target, approved);
      const result = await f.activate.activate({
        rule: target.rule,
        to: "enforce",
      });
      expect(result).toMatchObject({
        rule: target.rule,
        from: "audit",
        to: "enforce",
        activated: true,
        idea: "0224",
      });
      expect(withMode).toHaveBeenCalledWith(
        "INVENTORY",
        target.rule,
        "enforce",
      );
      expect(f.writeInventory).toHaveBeenCalledWith("EDITED");
      expect(f.recordEvent).toHaveBeenCalledWith(f.label, "0224");
      expect(f.syncDeny).toHaveBeenCalledTimes(
        target.deny === undefined ? 0 : 1,
      );
    });

    it("leaves the mode alone when no approval is on record", async () => {
      const f = fake(target, (label) => [
        { author: "claude", createdAt: REQUEST_AT, body: requestBody(label) },
      ]);
      const result = await f.activate.activate({
        rule: target.rule,
        to: "enforce",
      });
      expect(result.activated).toBe(false);
      expect(f.writeInventory).not.toHaveBeenCalled();
      expect(f.syncDeny).not.toHaveBeenCalled();
      expect(f.recordEvent).not.toHaveBeenCalled();
    });
  },
);
