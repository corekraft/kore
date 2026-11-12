import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const bash = (agent_type: string, command: string) =>
  decide({ agent_type, tool_name: "Bash", tool_input: { command } });

describe("role-read-only: the judge and orchestrator run an allowlist, not a blocklist", () => {
  const FORMS = [
    '/bin/bash -c "echo x > AGENTS.md"',
    "/usr/bin/env bash -c 'touch a'",
    "/bin/sh -c 'touch a'",
    "awk 'BEGIN{system(\"touch a\")}'",
    "gawk 'BEGIN{system(\"touch a\")}' /dev/null",
    "find . -exec touch {} ;",
    "find . -delete",
    "find . -fprint out.txt",
    "git -c alias.x='!touch a' x",
    "git -c core.pager='touch a' log",
    "git log --output=out.txt",
    "gh alias set x 'pr merge'",
    "gh api -X DELETE repos/corekraft/kore/issues/1",
    "gh pr comment 1 --body x",
    "osascript -e 'do shell script \"touch a\"'",
    "script -q /dev/null sh -c 'touch a'",
    "make clean",
    "touch a &",
    "sleep 1 &",
    "node skills/bin/harness.mjs plan tick --item x | cat",
    "python3 script.py",
    "node script.mjs",
    "npx vitest run",
    "curl -o a http://x",
    "sort -o a b",
    "tar xf a.tar",
    "sort --out=s.txt a",
    "sort --out x a",
    "sort --compress-prog=sh a",
    "date -s 1",
    "git grep --open-files-in-pa=sh x",
    "git log --out=x",
    "git --exec-path=/tmp log",
    "git --git-dir=/tmp log",
    "sqlite3 a.db 'create table t(x)'",
  ];
  for (const role of ["judge", "orchestrator"]) {
    it(`${role}: refuses every unlisted write or launch form`, async () => {
      for (const command of FORMS) {
        blocked(await bash(role, command), "role-read-only");
      }
    });
  }
});

describe("role-read-only: ordinary judge and orchestrator commands still pass", () => {
  it("still lets the judge run its ordinary commands", async () => {
    for (const command of [
      "node skills/bin/harness.mjs judge precheck 42 --reviewer r --json",
      "node skills/bin/harness.mjs ledger list --json",
      "node skills/bin/harness.mjs idea list",
      "gh pr view 42 --json body",
      "gh pr diff 42",
      "git log --oneline -5",
      "git diff main...HEAD -- tools",
      "git diff main...HEAD | grep foo | head -20",
      "gh pr checks 42 2>&1",
      "find . -name '*.ts'",
    ]) {
      allowed(await bash("judge", command));
    }
  });

  it("still lets the orchestrator run its session and herdr commands", async () => {
    for (const command of [
      "node skills/bin/harness.mjs session spawn --role judge --name j --brief b --no-wait",
      "node skills/bin/harness.mjs session wait j",
      "node skills/bin/harness.mjs ledger list",
      "node skills/bin/harness.mjs idea list",
      "gh issue list --label ready-for-agent",
      "gh issue view 314",
      "gh pr view 42",
      "git log --oneline -5",
      "herdr agent read j --source recent-unwrapped",
      "herdr agent list",
      "herdr pane list",
    ]) {
      allowed(await bash("orchestrator", command));
    }
  });

  it("blocks the judge from herdr and the orchestrator from herdr verbs that send input or change panes", async () => {
    blocked(await bash("judge", "herdr agent list"), "role-read-only");
    for (const command of [
      "herdr pane send-text w3:p1 hi",
      "herdr agent prompt j hi",
      "herdr agent send-keys j enter",
      "herdr pane split w1:p1",
      "herdr server stop",
    ]) {
      blocked(await bash("orchestrator", command), "role-read-only");
    }
  });

  it("leaves the writer unbounded by the allowlist", async () => {
    allowed(await bash("writer", "make test"));
    allowed(await bash("writer", "/bin/bash -c 'touch a'"));
  });
});
