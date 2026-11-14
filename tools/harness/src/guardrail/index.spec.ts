// The guardrail barrel: the public surface other domains import. Each file it
// re-exports is an automock, so only the wiring is under test.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import * as commands from "./commands.js";
import * as deny from "./deny.js";
import * as inventory from "./inventory.js";
import * as read from "./read.js";

vi.mock("./commands.js");
vi.mock("./deny.js");
vi.mock("./inventory.js");
vi.mock("./read.js");

describe("the guardrail barrel", () => {
  it("exposes exactly the public surface, by name", () => {
    expect(Object.keys(barrel).sort()).toEqual(
      [
        "GUARDRAIL_KINDS",
        "GuardrailError",
        "INVENTORY_PATH",
        "MODES",
        "MissingInventoryError",
        "auditRuleNames",
        "denyDrift",
        "denyList",
        "denyMatches",
        "denyRules",
        "findInventory",
        "guardrailCommands",
        "modeOf",
        "parseInventory",
        "readInventory",
        "settingsWithDeny",
      ].sort(),
    );
  });

  it("re-exports each inventory name as the inventory module's own", () => {
    expect(barrel.GuardrailError).toBe(inventory.GuardrailError);
    expect(barrel.MissingInventoryError).toBe(inventory.MissingInventoryError);
    expect(barrel.INVENTORY_PATH).toBe(inventory.INVENTORY_PATH);
    expect(barrel.GUARDRAIL_KINDS).toBe(inventory.KINDS);
    expect(barrel.MODES).toBe(inventory.MODES);
    expect(barrel.auditRuleNames).toBe(inventory.auditRuleNames);
    expect(barrel.modeOf).toBe(inventory.modeOf);
    expect(barrel.parseInventory).toBe(inventory.parseInventory);
  });

  it("re-exports the deny, read and command names as their modules' own", () => {
    expect(barrel.denyDrift).toBe(deny.denyDrift);
    expect(barrel.denyList).toBe(deny.denyList);
    expect(barrel.denyMatches).toBe(deny.denyMatches);
    expect(barrel.denyRules).toBe(deny.denyRules);
    expect(barrel.settingsWithDeny).toBe(deny.settingsWithDeny);
    expect(barrel.findInventory).toBe(read.findInventory);
    expect(barrel.readInventory).toBe(read.readInventory);
    expect(barrel.guardrailCommands).toBe(commands.guardrailCommands);
  });
});
