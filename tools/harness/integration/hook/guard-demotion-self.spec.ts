import { describe, expect, it } from "vitest";
import { committedInventoryText } from "../../src/testing/index.js";
import { guard } from "./guard-modes-support.js";

describe("the guard blocks the demotion of guardrail-demotion itself", () => {
  it("blocks, naming the approval it needs, on an Edit that enforces it to audit", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Edit",
        tool_input: {
          file_path: "/repo/.claude/guardrails.yaml",
          old_string:
            '"mode": "enforce", "owner": "tools/harness/src/hook/guard-guardrails.ts"',
          new_string:
            '"mode": "audit", "owner": "tools/harness/src/hook/guard-guardrails.ts"',
        },
      },
      committedInventoryText,
    );
    expect(result.code).toBe(2);
    expect(result.err).toBe(
      "[guard:guardrail-demotion] .claude/guardrails.yaml turns guardrail-demotion from enforce to audit by hand. A person approves a guardrail's mode and deny patterns (ADR 0080). Instead, leave them and ask the user to approve the change.\n",
    );
    expect(result.out).toBe("");
  });
});
