// The inventory text edit: one line per rule, so a mode flips or an entry leaves without touching its neighbours.
// Docs: infra/plans/12-self-improving-loop.md#step-4-guardrail-activation-gate

import { describe, expect, it } from "vitest";
import { GuardrailError } from "./inventory.js";
import { withMode, withoutRule } from "./edit.js";

const TEXT = [
  "{",
  '  "guardrails": [',
  '    { "rule": "bare-glob", "kind": "bash", "mode": "audit", "owner": "o" },',
  '    { "rule": "no-verify", "kind": "bash", "mode": "enforce", "owner": "o" },',
  '    { "rule": "last", "kind": "file", "mode": "audit", "owner": "o" }',
  "  ]",
  "}",
  "",
].join("\n");

describe("withMode", () => {
  it("changes only the named rule's mode", () => {
    expect(withMode(TEXT, "bare-glob", "enforce")).toBe(
      TEXT.replace(
        '"rule": "bare-glob", "kind": "bash", "mode": "audit"',
        '"rule": "bare-glob", "kind": "bash", "mode": "enforce"',
      ),
    );
  });

  it("refuses a rule that is not on a line of its own, changing nothing", () => {
    expect(() => withMode(TEXT, "missing", "enforce")).toThrow(GuardrailError);
  });
});

describe("withoutRule", () => {
  it("drops the entry's line and keeps the others", () => {
    expect(withoutRule(TEXT, "no-verify")).toBe(
      TEXT.replace(
        '    { "rule": "no-verify", "kind": "bash", "mode": "enforce", "owner": "o" },\n',
        "",
      ),
    );
  });

  it("drops the trailing comma of the entry before when the last entry goes", () => {
    expect(withoutRule(TEXT, "last")).toBe(
      TEXT.replace(
        '"owner": "o" },\n    { "rule": "last", "kind": "file", "mode": "audit", "owner": "o" }\n',
        '"owner": "o" }\n',
      ),
    );
  });

  it("refuses a rule that is not on a line of its own", () => {
    expect(() => withoutRule(TEXT, "missing")).toThrow(GuardrailError);
  });
});
