import { describe, expect, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const bash = (role: string, command: string) =>
  decide({
    agent_type: role,
    tool_name: "Bash",
    tool_input: { command },
  });

const ALL_ROLES = [
  "writer",
  "challenger",
  "reader",
  "refiner",
  "challenger",
  "judge",
];

describe("role-no-merge: the judge approve tool", () => {
  it("lets only the judge run the approve tool, and not past the ledger", async () => {
    allowed(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge approve 12 --reviewer bot --json",
      ),
    );
    for (const role of ["writer"]) {
      blocked(
        await bash(role, "node skills/bin/harness.mjs judge approve 12"),
        "role-no-merge",
      );
    }
    for (const role of ["reader", "refiner"]) {
      blocked(
        await bash(role, "node skills/bin/harness.mjs judge approve 12"),
        "role-read-only",
      );
    }
    blocked(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge approve 12 --ledger /tmp/x.jsonl",
      ),
      "role-read-only",
    );
  });

  it.each(ALL_ROLES)(
    "blocks a raw gh pr review --approve for the %s",
    async (role) => {
      const result = await bash(role, "gh pr review 12 --approve");
      expect(result.action).toBe("block");
    },
  );

  it.each(ALL_ROLES)(
    "blocks a review posted through the REST API for the %s",
    async (role) => {
      const result = await bash(
        role,
        "gh api -X POST repos/o/r/pulls/12/reviews -f event=APPROVE",
      );
      expect(result.action).toBe("block");
    },
  );
});
