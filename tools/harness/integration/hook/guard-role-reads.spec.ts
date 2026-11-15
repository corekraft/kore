import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

describe("role guard: the reader's shell refuses options that write or execute", () => {
  it("blocks sed (its w and e commands), sort -o, tree -o, git --output= and find's file outputs", async () => {
    for (const command of [
      "sed 'w out.txt' a.ts",
      "sed -n 's/a/b/w out.txt' a.ts",
      "sort -o out.txt a.txt",
      "sort -ro out.txt a.txt",
      "sort --output=out.txt a.txt",
      "sort --compress-program=./x a.txt",
      "tree -o out.txt",
      "tree -L 2 -o out.txt",
      "git diff --output=out.patch",
      "git log --output=out.txt",
      "git show --output out.txt HEAD",
      "find . -fprintf out.txt x",
      "find . -fls out.txt",
      "find . -fprint0 out.txt",
      "rg --pre ./x foo",
      "rg --hostname-bin ./x foo",
      "git log | cat 1<>AGENTS.md",
      "tree -H . -R",
    ]) {
      const result = await bash("reader", command);
      assert.equal(result.action, "block", command);
    }
  });

  it("still allows the read forms", async () => {
    for (const command of [
      "sort a.txt",
      "tree -L 2",
      "git diff HEAD~1",
      "git log --oneline -5",
      "find . -name '*.ts' -print",
      "rg foo tools",
    ]) {
      allowed(await bash("reader", command));
    }
  });
});

describe("role guard: the challenger's git cannot show code", () => {
  it("blocks every form that prints changed lines", async () => {
    for (const command of [
      "git log -p",
      "git log -L1,5:a.ts",
      "git log -L:main:a.ts",
      "git log --word-diff",
      "git log --word-diff=color",
      "git log --color-words",
      "git log --patch-with-stat",
      "git log --stat",
      "git log --cc",
      "git log --full-diff",
      "git status -v",
    ]) {
      blocked(await bash("challenger", command), "role-no-code");
    }
  });

  it("allows history and status summaries", async () => {
    for (const command of [
      "git log --oneline -5",
      "git log --author=x --since=2026-01-01",
      "git log -n 3 --format=%H",
      "git status --short",
    ]) {
      allowed(await bash("challenger", command));
    }
  });
});

describe("role guard: what it does not cover", () => {
  it("a command substitution is blocked, since it hides a command from the check", async () => {
    for (const role of ["challenger", "reader"]) {
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

describe("role guard: the challenger cannot read code", () => {
  it("Read, Grep and Glob are blocked outside plans, docs and ideas", async () => {
    blocked(
      await as("challenger", "Read", {
        file_path: "/repo/tools/kore/src/a.ts",
      }),
      "role-no-code",
    );
    blocked(
      await as("challenger", "Grep", { pattern: "x", path: "/repo/tools" }),
      "role-no-code",
    );
    blocked(
      await as("challenger", "Glob", { pattern: "**/*.ts" }),
      "role-no-code",
    );
  });

  it("Read of a plan, an idea or an ADR passes", async () => {
    allowed(
      await as("challenger", "Read", {
        file_path: "/repo/infra/plans/11-agent-delivery-loop.md",
      }),
    );
    allowed(
      await as("challenger", "Read", {
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
      "node skills/bin/harness.mjs plan active; cat a.ts",
    ]) {
      blocked(await bash("challenger", command), "role-no-code");
    }
  });

  it("the harness, issue and status commands pass", async () => {
    for (const command of [
      "node skills/bin/harness.mjs plan active",
      "gh issue list --label ready-for-agent",
      "gh pr view 12",
      "git log --oneline -5",
      "git status",
    ]) {
      allowed(await bash("challenger", command));
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
