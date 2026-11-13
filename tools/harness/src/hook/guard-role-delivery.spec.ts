import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });
const write = (role: string, file_path: string) =>
  as(role, "Write", { file_path, content: "x" });

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
      "queue next --json",
      "queue send-backs 50",
      "queue escalate 50",
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

describe("role-read-only: the judge precheck", () => {
  it("lets the judge run its precheck, and not the orchestrator", async () => {
    allowed(
      await bash(
        "judge",
        "node skills/bin/harness.mjs judge precheck 42 --json",
      ),
    );
    blocked(
      await bash(
        "orchestrator",
        "node skills/bin/harness.mjs judge precheck 42",
      ),
      "role-read-only",
    );
  });

  it("blocks the judge from choosing where the precheck writes with --ledger", async () => {
    for (const flag of [
      "--ledger AGENTS.md",
      "--ledger=AGENTS.md",
      "--json --ledger /tmp/x",
    ]) {
      blocked(
        await bash(
          "judge",
          `node skills/bin/harness.mjs judge precheck 42 ${flag}`,
        ),
        "role-read-only",
      );
    }
  });

  it("blocks a judge or orchestrator command that sets an environment variable, such as KORE_ROOT", async () => {
    for (const role of ["judge", "orchestrator"]) {
      for (const command of [
        "KORE_ROOT=/anywhere node skills/bin/harness.mjs judge precheck 42",
        "KORE_ROOT=/anywhere node skills/bin/harness.mjs ledger list",
        "env KORE_ROOT=/anywhere node skills/bin/harness.mjs plan active",
        "sudo node skills/bin/harness.mjs plan active",
        "time node skills/bin/harness.mjs plan active",
        "command node skills/bin/harness.mjs plan active",
        "cd /tmp && KORE_ROOT=/x node skills/bin/harness.mjs plan active",
        "export KORE_ROOT=/x; node skills/bin/harness.mjs judge precheck 42",
        "export KORE_ROOT=/x && node skills/bin/harness.mjs judge precheck 42",
        "declare -x KORE_ROOT=/x; node skills/bin/harness.mjs judge precheck 42",
        "typeset -x KORE_ROOT=/x; node skills/bin/harness.mjs plan active",
        "source ./env.sh; node skills/bin/harness.mjs plan active",
        ". ./env.sh && node skills/bin/harness.mjs plan active",
        "alias node='echo'; node skills/bin/harness.mjs plan active",
        "unset KORE_ROOT; node skills/bin/harness.mjs plan active",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
    }
  });

  it("still lets a writer set a variable for a test run, since no harness allowlist applies to it", async () => {
    allowed(await bash("writer", "KORE_TEST_WORKERS=2 npx vitest run"));
    allowed(await bash("judge", "grep export README.md"));
  });
});

describe("role-read-only: the judge and orchestrator run plain commands only", () => {
  const H = "node skills/bin/harness.mjs judge precheck 42";
  const SHELL_FORMS = [
    `( export KORE_ROOT=/x; ${H} )`,
    `(export KORE_ROOT=/x; ${H})`,
    `{ export KORE_ROOT=/x; ${H}; }`,
    `echo $(KORE_ROOT=/x ${H})`,
    `echo \`${H}\``,
    `cat <(${H})`,
    `eval 'export KORE_ROOT=/x'; ${H}`,
    `builtin export KORE_ROOT=/x; ${H}`,
    `bash -c 'KORE_ROOT=/x ${H}'`,
    `sh -c 'KORE_ROOT=/x ${H}'`,
    `zsh -c 'KORE_ROOT=/x ${H}'`,
    `echo 42 | xargs env KORE_ROOT=/x node skills/bin/harness.mjs judge precheck`,
    `timeout 5 env KORE_ROOT=/x ${H}`,
    `nice ${H}`,
    `if true; then export KORE_ROOT=/x; fi; ${H}`,
    `! export KORE_ROOT=/x; ${H}`,
    `for i in 1; do export KORE_ROOT=/x; done; ${H}`,
    `while true; do ${H}; done`,
  ];

  for (const role of ["judge", "orchestrator"]) {
    it(`${role}: every shell form that could hide an environment change is blocked`, async () => {
      for (const command of SHELL_FORMS) {
        blocked(await bash(role, command), "role-read-only");
      }
    });
  }

  it("ordinary judge commands still pass", async () => {
    for (const command of [
      `${H} --reviewer r --json`,
      "node skills/bin/harness.mjs ledger list",
      "gh pr view 42 --json body",
      "git log --oneline -5",
      "gh pr checks 42 && git status",
    ]) {
      allowed(await bash("judge", command));
    }
  });
});
