import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, decide } from "./guard-support.js";

const bash = (role: string, command: string) =>
  decide({ agent_type: role, tool_name: "Bash", tool_input: { command } });
const harness = (...words: string[]) =>
  `node skills/bin/harness.mjs ${words.join(" ")}`;

describe("role guard: the concierge's status tool", () => {
  it("only the concierge may run harness status, with or without --json", async () => {
    for (const words of ["status", "status --json"]) {
      allowed(await bash("concierge", harness(words)));
      const result = await bash("reader", harness(words));
      assert.equal(result.action, "block", `reader: ${words}`);
    }
    const stray = await bash("concierge", harness("status extra"));
    assert.equal(stray.action, "block");
  });

  it("the concierge may read guardrail status, and no other guardrail command may", async () => {
    for (const words of ["guardrail status", "guardrail status --json"]) {
      allowed(await bash("concierge", harness(words)));
      for (const role of ["reader", "challenger"]) {
        const result = await bash(role, harness(words));
        assert.equal(result.action, "block", `${role}: ${words}`);
      }
    }
    for (const words of [
      "guardrail request --rule image-digest --to enforce --idea 1",
      "guardrail deny --write",
      "guardrail status --ledger /tmp/x",
      "guardrail status extra",
      "guardrail status --json extra",
    ]) {
      const result = await bash("concierge", harness(words));
      assert.equal(result.action, "block", words);
    }
  });

  it("the concierge has no path to message the orchestrator", async () => {
    for (const command of [
      'herdr pane send-text w3:p1 "hello"',
      "herdr pane send-keys w3:p1 enter",
      harness("session spawn --role writer --name x --brief y"),
      harness("session send --pane w3:p1"),
    ]) {
      const result = await bash("concierge", command);
      assert.equal(result.action, "block", command);
    }
  });

  it("the allowlisted delivery roles (orchestrator, judge) still block status; the writer has no harness allowlist", async () => {
    for (const role of ["orchestrator", "judge"]) {
      for (const words of ["status", "status --json"]) {
        const result = await bash(role, harness(words));
        assert.equal(result.action, "block", `${role}: ${words}`);
      }
    }
  });
});
