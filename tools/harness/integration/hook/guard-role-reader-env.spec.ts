import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });

describe("a bounded role cannot start a command with an environment assignment", () => {
  const ASSIGNED = [
    "GIT_EXTERNAL_DIFF='gh issue edit 300 --add-label ready-for-agent #' git diff HEAD~1",
    "GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0='sh -c x' git log",
    "PAGER='sh -c x' git log",
    "KORE_ROOT=/tmp/other node skills/bin/harness.mjs idea list",
    "env KORE_ROOT=/tmp/other node skills/bin/harness.mjs idea list",
    "echo ok && PAGER=x git log",
    "export KORE_ROOT=/x; node skills/bin/harness.mjs idea list",
    "export KORE_ROOT=/x && node skills/bin/harness.mjs idea list",
    "declare -x KORE_ROOT=/x; node skills/bin/harness.mjs idea list",
    "typeset -x PAGER=x; git log",
    "readonly PAGER=x; git log",
    "set -a; git log",
    "unset HOME; git log",
    "alias git='gh issue close 1 #'; git log",
    "source ./env.sh; git log",
    ". ./env.sh; git log",
  ];

  it("blocks every assigned form for the reader", async () => {
    for (const command of ASSIGNED) {
      blocked(await bash("reader", command), "role-read-only");
    }
  });

  it("a variable name inside an argument is not an assignment", async () => {
    allowed(await bash("reader", "grep KORE_ROOT=x README.md"));
    allowed(await bash("reader", "echo KORE_ROOT=x"));
    allowed(await bash("reader", "grep export README.md"));
  });
});

describe("git options that run a program are refused for every bounded role", () => {
  const PROGRAM_OPTIONS = [
    "git diff --ext-diff HEAD~1",
    "git log -p --textconv",
    "git --config-env=core.pager=X log",
    "git show --ext-diff HEAD",
    "git -c core.pager=x log",
    "git -c diff.external=x diff HEAD~1",
  ];

  it("blocks each for the reader", async () => {
    for (const command of PROGRAM_OPTIONS) {
      blocked(await bash("reader", command), "role-read-only");
    }
  });

  it("still lets the reader run a plain git diff", async () => {
    allowed(await bash("reader", "git diff HEAD~1"));
  });
});
