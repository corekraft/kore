import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDefinition } from "./agent-definition.js";

const ROOT = join(import.meta.dirname, "../../../..");

describe("the concierge definition", () => {
  it("grants no file read or write tool and no way to message another session", () => {
    const { tools = [] } = parseDefinition(
      readFileSync(join(ROOT, ".claude/agents/concierge.md"), "utf8"),
    );
    expect(tools.length).toBeGreaterThan(0);
    for (const forbidden of [
      "Read",
      "Grep",
      "Glob",
      "Write",
      "Edit",
      "NotebookEdit",
      "SendMessage",
      "Agent",
    ]) {
      expect(tools).not.toContain(forbidden);
    }
  });
});
