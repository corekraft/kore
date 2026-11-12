import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

describe("role guard: neither the concierge nor the reader can write files", () => {
  for (const role of ["concierge", "reader"]) {
    it(`${role}: Write, Edit and NotebookEdit are blocked`, async () => {
      blocked(
        await as(role, "Write", { file_path: "/repo/a.ts", content: "x" }),
        "role-read-only",
      );
      blocked(
        await as(role, "Edit", {
          file_path: "/repo/a.ts",
          old_string: "a",
          new_string: "b",
        }),
        "role-read-only",
      );
      blocked(
        await as(role, "NotebookEdit", { notebook_path: "/repo/a.ipynb" }),
        "role-read-only",
      );
    });

    it(`${role}: shell commands that write files are blocked`, async () => {
      for (const command of [
        "echo hi > notes.md",
        "echo hi >> notes.md",
        "cat a | tee notes.md",
        "sed -i 's/a/b/' README.md",
        "cp a b",
        "mv a b",
        "rm a",
        "mkdir x",
        "touch x",
        "git commit -m x",
        "git add .",
        "git push",
        "git checkout main",
        "gh pr merge 1 --squash",
        "echo hi >notes.md",
        "echo hi 1> notes.md",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
    });

    it(`${role}: redirecting to /dev/null and reading status still pass`, async () => {
      allowed(
        await bash(role, "node skills/bin/harness.mjs plan status 2>/dev/null"),
      );
      allowed(await bash(role, "gh issue list --label ready-for-agent"));
      allowed(
        await bash(role, "node skills/bin/harness.mjs plan status > /dev/null"),
      );
      allowed(await bash(role, "date 2> /dev/null"));
    });
  }
});

describe("role guard: commands that are not known read-only", () => {
  it("are blocked for both roles, whichever rule names them", async () => {
    for (const role of ["concierge", "reader"]) {
      for (const command of [
        "gh pr create --title x",
        "gh pr comment 1 --body x",
        "gh issue create --title x",
        "gh api -X POST repos/corekraft/kore/issues",
        'node -e \'require("fs").writeFileSync("a","b")\'',
        'python3 -c \'open("a","w")\'',
        "find . -name x -delete",
        "node /tmp/x/skills/bin/harness.mjs plan status",
      ]) {
        const result = await bash(role, command);
        assert.equal(result.action, "block", `${role}: ${command}`);
      }
    }
  });
});

describe("role guard: what it does not cover", () => {
  it("a command substitution is blocked, since it hides a command from the check", async () => {
    for (const role of ["concierge", "reader"]) {
      for (const command of [
        "ls $(touch x)",
        "ls `touch x`",
        "echo $(cat a.ts)",
      ]) {
        const result = await bash(role, command);
        assert.equal(result.action, "block", `${role}: ${command}`);
      }
    }
  });

  it("other roles and sessions without a role are not bounded by it", async () => {
    allowed(
      await as("writer", "Write", { file_path: "/repo/a.ts", content: "x" }),
    );
    allowed(
      await decide({
        tool_name: "Write",
        tool_input: { file_path: "/repo/a.ts", content: "x" },
      }),
    );
  });
});

describe("role guard: the concierge cannot read code", () => {
  it("Read, Grep and Glob are blocked outside plans, docs and ideas", async () => {
    blocked(
      await as("concierge", "Read", { file_path: "/repo/tools/kore/src/a.ts" }),
      "role-no-code",
    );
    blocked(
      await as("concierge", "Grep", { pattern: "x", path: "/repo/tools" }),
      "role-no-code",
    );
    blocked(
      await as("concierge", "Glob", { pattern: "**/*.ts" }),
      "role-no-code",
    );
  });

  it("Read of a plan, an idea or an ADR passes", async () => {
    allowed(
      await as("concierge", "Read", {
        file_path: "/repo/infra/plans/11-agent-delivery-loop.md",
      }),
    );
    allowed(
      await as("concierge", "Read", {
        file_path: "/repo/docs/ideas/0001-x.md",
      }),
    );
  });

  it("shell commands that read files or call anything but the status tools are blocked", async () => {
    for (const command of [
      "cat tools/kore/src/a.ts",
      "grep -r foo tools",
      "git show HEAD:tools/kore/src/a.ts",
      "git log -p",
      "gh pr diff 1",
      "gh api repos/corekraft/kore/contents/tools",
      "node skills/bin/harness.mjs plan status; cat a.ts",
    ]) {
      blocked(await bash("concierge", command), "role-no-code");
    }
  });

  it("the harness, issue and status commands pass", async () => {
    for (const command of [
      "node skills/bin/harness.mjs plan status",
      "node skills/bin/harness.mjs idea new --title x",
      "gh issue list --label ready-for-agent",
      "gh pr view 12",
      "git log --oneline -5",
      "git status",
    ]) {
      allowed(await bash("concierge", command));
    }
  });

  it("the reader may read code", async () => {
    allowed(
      await as("reader", "Read", { file_path: "/repo/tools/kore/src/a.ts" }),
    );
    allowed(await bash("reader", "grep -r foo tools"));
    allowed(await bash("reader", "git show HEAD:README.md"));
  });
});
