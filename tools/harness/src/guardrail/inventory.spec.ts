// The inventory unit: parsing and checking the text, and reading modes from it.
// It has no collaborators; GuardrailError is a real error class.
// Docs: infra/plans/14-test-tiers.md#step-1-foundations

import { describe, expect, it } from "vitest";
import {
  GuardrailError,
  auditRuleNames,
  modeOf,
  parseInventory,
} from "./inventory.js";

const entry = (over: Record<string, unknown> = {}) => ({
  rule: "no-verify",
  kind: "bash",
  mode: "enforce",
  owner: "tools/harness/src/hook/guard-commands.ts",
  ...over,
});
const text = (...entries: unknown[]) => JSON.stringify({ guardrails: entries });

describe("parseInventory: a valid inventory", () => {
  it("lists each guardrail with its kind, mode and owner", () => {
    const inventory = parseInventory(text(entry(), entry({ rule: "x" })));
    expect(inventory.guardrails.map((g) => g.rule)).toEqual(["no-verify", "x"]);
    expect(inventory.guardrails[0]).toEqual(entry());
  });

  it("accepts a ruleset kind and a note saying why a rule has its mode", () => {
    const inventory = parseInventory(
      text(entry({ kind: "ruleset", note: "Starts in enforce: live today." })),
    );
    expect(inventory.guardrails[0]).toMatchObject({
      kind: "ruleset",
      note: "Starts in enforce: live today.",
    });
  });

  it("keeps a deny list on a bash rule as written", () => {
    const inventory = parseInventory(
      text(entry({ deny: ["Bash(helm uninstall:*)"] })),
    );
    expect(inventory.guardrails[0]?.deny).toEqual(["Bash(helm uninstall:*)"]);
  });
});

describe("parseInventory: rejected inventories", () => {
  it("rejects a blank note", () => {
    expect(() => parseInventory(text(entry({ note: " " })))).toThrow(/note/);
  });

  it("rejects a deny list on a ruleset rule", () => {
    expect(() =>
      parseInventory(
        text(entry({ kind: "ruleset", deny: ["Bash(helm uninstall:*)"] })),
      ),
    ).toThrow(/does not fit its kind/);
  });

  it.each([
    ["an empty deny list", entry({ deny: [] }), /deny/],
    ["a pattern that is not a permission rule", entry({ deny: ["x"] }), /deny/],
    [
      "a Bash pattern on a file rule",
      entry({ kind: "file", deny: ["Bash(helm:*)"] }),
      /kind/,
    ],
    ["a Read pattern on a bash rule", entry({ deny: ["Read(a)"] }), /kind/],
    [
      "a mid-pattern wildcard with a trailing :*",
      entry({ deny: ["Bash(k3d * cluster:*)"] }),
      /:\*/,
    ],
  ])("rejects %s", (_, bad, message) => {
    expect(() => parseInventory(text(bad))).toThrow(GuardrailError);
    expect(() => parseInventory(text(bad))).toThrow(message);
  });

  it.each([
    ["not JSON", "guardrails: [", /JSON-compatible/],
    ["not an object", "[]", /guardrails/],
    ["no guardrails list", "{}", /guardrails/],
    ["a bad mode", text(entry({ mode: "warn" })), /mode.*audit.*enforce/],
    ["a bad kind", text(entry({ kind: "x" })), /kind/],
    ["a missing owner", text(entry({ owner: "" })), /owner/],
    ["a bad rule name", text(entry({ rule: "Not Valid" })), /rule/],
    ["an unknown field", text(entry({ extra: 1 })), /extra/],
    [
      "two entries for one rule",
      text(entry(), entry({ owner: "elsewhere" })),
      /no-verify.*exactly one entry/,
    ],
  ])(
    "rejects %s with a message that says how to fix it",
    (_, body, message) => {
      expect(() => parseInventory(body)).toThrow(GuardrailError);
      expect(() => parseInventory(body)).toThrow(message);
    },
  );
});

describe("guardrail modes", () => {
  const inventory = parseInventory(
    text(entry({ mode: "audit" }), entry({ rule: "y" })),
  );

  it("reads a rule's mode from the inventory", () => {
    expect(modeOf(inventory, "no-verify")).toBe("audit");
    expect(modeOf(inventory, "y")).toBe("enforce");
  });

  it("enforces a rule the inventory does not list", () => {
    expect(modeOf(inventory, "unlisted")).toBe("enforce");
  });

  it("names the audit rules, sorted", () => {
    expect(auditRuleNames(inventory)).toEqual(["no-verify"]);
  });
});
