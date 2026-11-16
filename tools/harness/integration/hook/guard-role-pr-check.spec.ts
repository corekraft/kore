import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const bash = (role: string, command: string) =>
  decide({
    agent_type: role,
    tool_name: "Bash",
    tool_input: { command },
  });

describe("role-no-merge: a writer may check its own pull request", () => {
  it("lets the writer run pr check on its own PR, read-only and with --json", async () => {
    allowed(await bash("writer", "node skills/bin/harness.mjs pr check 12"));
    allowed(
      await bash("writer", "node skills/bin/harness.mjs pr check 12 --json"),
    );
  });

  it("still blocks the writer from judge approve, merge and send-back", async () => {
    blocked(
      await bash("writer", "node skills/bin/harness.mjs judge approve 12"),
      "role-no-merge",
    );
    blocked(
      await bash("writer", "node skills/bin/harness.mjs judge merge 12"),
      "role-no-merge",
    );
    blocked(
      await bash(
        "writer",
        "node skills/bin/harness.mjs judge send-back 12 --reason x",
      ),
      "role-no-merge",
    );
  });
});
