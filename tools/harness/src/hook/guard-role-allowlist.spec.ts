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
    "git log | cat 1<>AGENTS.md",
    "echo x 1<>AGENTS.md",
    "echo x <>AGENTS.md",
    "echo x 1<> AGENTS.md",
    "tree -H . -R",
    "tree -R -H .",
    "herdr pane send-text w3:p1 hello",
    "herdr pane send-keys w3:p1 C-c",
    "herdr pane send-keys w3:p1 enter extra",
    "herdr pane send-text w3:p1 '[herdr:x] finished: RESULT done' extra",
    "herdr agent prompt j hi",
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

describe("role-read-only: the finish broadcast and benign reads", () => {
  const FINISH = [
    'herdr pane send-text w3:p1 "[herdr:judge-314] finished: RESULT done; summary in pane w3:p9" && herdr pane send-keys w3:p1 enter',
    "herdr pane send-text w3:p1 '[herdr:a.b_c] finished: RESULT blocked; summary in pane w3:p2'",
    "herdr pane send-keys w3:p1 enter",
  ];
  for (const role of ["judge", "orchestrator"]) {
    it(`${role}: may send exactly its finish line to a pane, and nothing else through send-text or send-keys`, async () => {
      for (const command of FINISH) {
        allowed(await bash(role, command));
      }
      for (const command of [
        "herdr pane send-text w3:p1 'rm -rf /'",
        "herdr pane send-text w3:p1 '[herdr:x] hello'",
        "herdr pane send-text w3:p1 '[herdr:x] finished: RESULT done' && herdr pane send-keys w3:p1 C-c",
        "herdr pane send-keys w3:p1 enter enter",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
    });
  }

  it("keeps herdr agent prompt refused for the orchestrator: sessions are launched through session spawn (ADR 0078)", async () => {
    blocked(
      await bash("orchestrator", "herdr agent prompt j 'do it'"),
      "role-read-only",
    );
  });

  it("allows an allowlisted read in the background: it still runs only an allowlisted command, so `&` adds no write", async () => {
    for (const role of ["judge", "orchestrator"]) {
      allowed(await bash(role, "echo x &"));
      allowed(await bash(role, "git log --oneline -3 &"));
      blocked(await bash(role, "touch a &"), "role-read-only");
    }
  });

  it("allows git reads whose options merely share a prefix with a writing option", async () => {
    for (const command of [
      "git diff --exit-code main",
      "git grep --context=3 foo",
      "git log --exclude='refs/tags/*' --oneline",
      "git grep --extended-regexp foo",
    ]) {
      allowed(await bash("judge", command));
    }
  });
});
