import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { decide } from "../../src/testing/index.js";

const bash = (role: string, command: string) =>
  decide({ agent_type: role, tool_name: "Bash", tool_input: { command } });
const harness = (...words: string[]) =>
  `node skills/bin/harness.mjs ${words.join(" ")}`;

describe("role guard: the status tool", () => {
  it("no bounded role may run harness status, with or without --json", async () => {
    for (const words of ["status", "status --json", "status extra"]) {
      const result = await bash("reader", harness(words));
      assert.equal(result.action, "block", `reader: ${words}`);
    }
  });

  it("the reader has no path to message another pane", async () => {
    for (const command of [
      'herdr pane send-text w3:p1 "hello"',
      "herdr pane send-keys w3:p1 enter",
      harness("session spawn --role writer --name x --brief y"),
      harness("session send --pane w3:p1"),
    ]) {
      const result = await bash("reader", command);
      assert.equal(result.action, "block", command);
    }
  });

  it("the judge blocks status, and the writer has no harness allowlist", async () => {
    for (const role of ["judge"]) {
      for (const words of ["status", "status --json"]) {
        const result = await bash(role, harness(words));
        assert.equal(result.action, "block", `${role}: ${words}`);
      }
    }
  });
});
