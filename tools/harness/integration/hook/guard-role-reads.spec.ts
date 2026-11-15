import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, decide } from "../../src/testing/index.js";

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

describe("role guard: what it does not cover", () => {
  it("a command substitution is blocked, since it hides a command from the check", async () => {
    for (const role of ["reader"]) {
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

describe("role guard: the reader reads code", () => {
  it("the reader may read code", async () => {
    allowed(
      await as("reader", "Read", { file_path: "/repo/tools/kore/src/a.ts" }),
    );
    allowed(await bash("reader", "grep -r foo tools"));
    allowed(await bash("reader", "git show HEAD:README.md"));
  });
});
