import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

describe("role guard: the reader cannot write files", () => {
  for (const role of ["reader"]) {
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
        await bash(role, "node skills/bin/harness.mjs plan active 2>/dev/null"),
      );
      allowed(await bash(role, "gh issue list --label ready-for-agent"));
      allowed(
        await bash(role, "node skills/bin/harness.mjs plan active > /dev/null"),
      );
      allowed(await bash(role, "date 2> /dev/null"));
    });
  }
});

describe("role guard: commands that are not known read-only", () => {
  it("are blocked for the reader, whichever rule names them", async () => {
    for (const role of ["reader"]) {
      for (const command of [
        "gh pr create --title x",
        "gh pr comment 1 --body x",
        "gh issue create --title x",
        "gh api -X POST repos/corekraft/kore/issues",
        'node -e \'require("fs").writeFileSync("a","b")\'',
        'python3 -c \'open("a","w")\'',
        "find . -name x -delete",
        "node /tmp/x/skills/bin/harness.mjs plan active",
      ]) {
        const result = await bash(role, command);
        assert.equal(result.action, "block", `${role}: ${command}`);
      }
    }
  });
});

const harness = (...words: string[]) =>
  `node skills/bin/harness.mjs ${words.join(" ")}`;

describe("role guard: harness commands are an explicit allowlist, not a prefix", () => {
  const writing = [
    "plan tick --item x",
    "plan next --text x",
    "plan clear-next",
    "adr new --title x",
    "adr supersede --old 1 --new 2",
    "flag activate some-flag --environment local",
    "outcome record --idea 1",
    "outcome close --idea 1",
    "ledger record --kind outcome",
    "ledger poll-herdr",
    "ledger poll-github",
    "session spawn --role writer --name x --brief y",
    "session close x",
  ];

  it("the reader cannot run a harness command that writes, spawns or activates", async () => {
    for (const role of ["reader"]) {
      for (const words of writing) {
        const result = await bash(role, harness(words));
        assert.equal(result.action, "block", `${role}: ${words}`);
      }
    }
  });

  it("the reader can read: plan active, idea list and show, flow report, ledger list", async () => {
    for (const role of ["reader"]) {
      for (const words of [
        "plan active",
        "idea list",
        "idea show --idea 3",
        "flow report --json",
        "ledger list --since 2026-11-01T00:00:00Z",
      ]) {
        allowed(await bash(role, harness(words)));
      }
    }
  });

  it("no bounded role may file or sync an idea", async () => {
    for (const words of ["idea new --title x", "idea sync --idea 3"]) {
      const result = await bash("reader", harness(words));
      assert.equal(result.action, "block", `reader: ${words}`);
    }
  });

  it("a harness call with no subcommand, or an unknown one, is blocked", async () => {
    for (const role of ["reader"]) {
      for (const words of [
        "",
        "--json",
        "plan",
        "plan active-ish",
        "nope list",
      ]) {
        const result = await bash(role, harness(words));
        assert.equal(result.action, "block", `${role}: '${words}'`);
      }
    }
  });
});
