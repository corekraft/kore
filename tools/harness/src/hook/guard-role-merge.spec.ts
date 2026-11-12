import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

const MERGES = [
  "gh pr merge 12 --squash",
  "cd x && gh pr merge 12 --auto",
  "gh api -X PUT repos/corekraft/kore/pulls/12/merge",
  "gh api repos/corekraft/kore/pulls/12/merge --method PUT",
];

describe("role-no-merge: the merge tool is the only way a role merges", () => {
  it("blocks the orchestrator, writer and judge from merging by any other path", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of MERGES) {
        blocked(await bash(role, command), "role-no-merge");
      }
    }
  });

  it("points a blocked merge at the merge tool", async () => {
    const result = await bash("judge", "gh pr merge 12 --squash");
    assert.match(result.message, /harness judge merge/);
  });

  it("lets only the judge run the merge and send-back tools", async () => {
    allowed(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 --reviewer bot --json",
      ),
    );
    allowed(
      await bash(
        "judge",
        'node skills/bin/harness.mjs judge send-back 12 --reason "no pattern"',
      ),
    );
    for (const role of ["orchestrator", "writer"]) {
      blocked(
        await bash(role, "node skills/bin/harness.mjs judge merge 12"),
        "role-no-merge",
      );
    }
    blocked(
      await bash(
        "orchestrator",
        "node skills/bin/harness.mjs judge send-back 12 --reason x",
      ),
      "role-no-merge",
    );
  });

  it("still blocks the judge from merging through a chained or wrapped call", async () => {
    blocked(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 && gh pr merge 13 --squash",
      ),
      "role-no-merge",
    );
    blocked(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge merge 12 --ledger /tmp/x.jsonl",
      ),
      "role-read-only",
    );
  });
});

describe("role-no-merge: what stays allowed", () => {
  it("still lets them read a pull request and mention merge in text", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      allowed(await bash(role, "gh pr view 12 --json mergeable"));
      allowed(await bash(role, 'echo "gh pr merge 12"'));
    }
  });

  it("does not bind a session with no role, so the person keeps gh pr merge --squash", async () => {
    allowed(
      await decide({
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 12 --squash" },
      }),
    );
    allowed(
      await decide({
        agent_type: "",
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 12 --squash" },
      }),
    );
  });

  it("does not bind an unknown role", async () => {
    allowed(await bash("someone-else", "gh pr merge 12"));
  });
});
