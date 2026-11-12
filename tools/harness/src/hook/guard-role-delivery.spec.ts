import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });
const write = (role: string, file_path: string) =>
  as(role, "Write", { file_path, content: "x" });

const MERGES = [
  "gh pr merge 12 --squash",
  "cd x && gh pr merge 12 --auto",
  "gh api -X PUT repos/corekraft/kore/pulls/12/merge",
  "gh api repos/corekraft/kore/pulls/12/merge --method PUT",
];

describe("role-no-merge: until the merge tool exists nobody merges", () => {
  it("blocks the orchestrator, writer and judge from merging by any path", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      for (const command of MERGES) {
        blocked(await bash(role, command), "role-no-merge");
      }
    }
  });

  it("still lets them read a pull request and mention merge in text", async () => {
    for (const role of ["orchestrator", "writer", "judge"]) {
      allowed(await bash(role, "gh pr view 12 --json mergeable"));
      allowed(await bash(role, 'echo "gh pr merge 12"'));
    }
  });

  it("does not bind a session with no role or an unknown one", async () => {
    allowed(await bash("someone-else", "gh pr merge 12"));
  });
});

describe("role-read-only: the judge and orchestrator never change files", () => {
  for (const role of ["judge", "orchestrator"]) {
    it(`${role}: file tools and writing commands are blocked`, async () => {
      blocked(await write(role, "/repo/a.ts"), "role-read-only");
      blocked(
        await as(role, "Edit", {
          file_path: "/repo/a.ts",
          old_string: "a",
          new_string: "b",
        }),
        "role-read-only",
      );
      for (const command of [
        "echo x > a.ts",
        "cat a | tee out.txt",
        "sed -i s/a/b/ a.ts",
        "cp a b",
        "mv a b",
        "rm a",
        "touch a",
        "git commit -am x",
        "git push",
        "node -e 'process.exit(0)'",
        "python3 -c 'print(1)'",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
    });

    it(`${role}: reading, the harness and null redirects pass`, async () => {
      for (const command of [
        "gh pr diff 12",
        "gh pr checks 12",
        "git diff main...HEAD 2>/dev/null",
        "git log --oneline -5",
        "node skills/bin/harness.mjs plan active > /dev/null",
        "node skills/bin/harness.mjs flag audit",
        "node skills/bin/harness.mjs session tier writer",
      ]) {
        allowed(await bash(role, command));
      }
    });
  }

  it("blocks inline scripts in perl and ruby and an in-place awk", async () => {
    for (const role of ["judge", "orchestrator"]) {
      for (const command of [
        "perl -pi -e 's/a/b/' a.ts",
        "perl -e 'print 1'",
        "ruby -e 'puts 1'",
        "awk -i inplace '{print}' a.ts",
        "gawk -i inplace '{print}' a.ts",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
    }
  });
});

describe("role-read-only: the harness is allowlisted per role", () => {
  const MUTATING = [
    "flag activate remote-thing --environment local",
    "plan tick --item x",
    "plan next --text x",
    "adr new --title x",
    "adr supersede --old 1 --new 2",
    "idea new --title x",
    "ledger record --kind outcome",
    "hook guard",
    "session spawn --role writer --name a --brief b",
  ];

  it("blocks the judge from every command that changes a file or launches a pane", async () => {
    for (const rest of [
      ...MUTATING,
      "session wait a",
      "session close a",
      "outcome record --idea 1",
      "outcome close --idea 1",
      "idea sync --idea 1",
    ]) {
      blocked(
        await bash("judge", `node skills/bin/harness.mjs ${rest}`),
        "role-read-only",
      );
    }
  });

  it("blocks the orchestrator from commands outside its job", async () => {
    for (const rest of MUTATING.filter((c) => !c.startsWith("session"))) {
      blocked(
        await bash("orchestrator", `node skills/bin/harness.mjs ${rest}`),
        "role-read-only",
      );
    }
  });

  it("lets the orchestrator run the session commands and the outcome and idea commands its job needs", async () => {
    for (const rest of [
      "session spawn --role writer --name a --brief b --worktree --no-wait",
      "session wait a",
      "session close a",
      "session tier writer",
      "session equalize",
      "idea sync --idea 1",
      "outcome record --idea 1 --kind verification",
      "outcome close --idea 1",
      "idea show --idea 1",
    ]) {
      allowed(
        await bash("orchestrator", `node skills/bin/harness.mjs ${rest}`),
      );
    }
  });

  it("does not trust another path to a harness bundle or a prefix of an allowed command", async () => {
    for (const role of ["judge", "orchestrator"]) {
      blocked(
        await bash(role, "node /tmp/x/skills/bin/harness.mjs plan active"),
        "role-read-only",
      );
      blocked(
        await bash(role, "node skills/bin/harness.mjs plan tick-all"),
        "role-read-only",
      );
    }
  });
});

describe("role-worktree: a writer works only in its own worktree", () => {
  it("blocks files outside the worktree, through .., and in the main checkout", async () => {
    blocked(await write("writer", "/elsewhere/kore/a.ts"), "role-worktree");
    blocked(await write("writer", "/repo/../main/a.ts"), "role-worktree");
    blocked(
      await as("writer", "Edit", {
        file_path: "/elsewhere/a.ts",
        old_string: "a",
        new_string: "b",
      }),
      "role-worktree",
    );
  });

  it("blocks shell commands that write, cd or run git outside the worktree", async () => {
    for (const command of [
      "cp a /elsewhere/b",
      "mv a /elsewhere/b",
      "rm /elsewhere/b",
      "touch /elsewhere/b",
      "echo x > /elsewhere/b",
      "echo x >/elsewhere/b",
      "cat a | tee /elsewhere/b",
      "mkdir ../sibling",
      "git -C /elsewhere commit -am x",
      "cd /elsewhere && git push",
      'node -e \'require("fs").writeFileSync("/elsewhere/b", "x")\'',
    ]) {
      blocked(await bash("writer", command), "role-worktree");
    }
  });

  it("allows work inside the worktree and scratch space in tmp", async () => {
    allowed(await write("writer", "/repo/tools/a.ts"));
    allowed(await write("writer", "tools/a.ts"));
    for (const command of [
      "git commit -am x",
      "git push -u origin HEAD",
      "git -C /repo status",
      "cd /repo/tools/harness && npx vitest run",
      "echo x > notes.md",
      "cp a /repo/b",
      "echo x > /tmp/scratch.txt",
      "node -e 'process.exit(0)'",
      "npx vitest run 2>/dev/null",
    ]) {
      allowed(await bash("writer", command));
    }
  });
});
