import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const bash = (agent_type: string, command: string) =>
  decide({ agent_type, tool_name: "Bash", tool_input: { command } });

describe("role-read-only: the judge run an allowlist, not a blocklist", () => {
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
  for (const role of ["judge"]) {
    it(`${role}: refuses every unlisted write or launch form`, async () => {
      for (const command of FORMS) {
        blocked(await bash(role, command), "role-read-only");
      }
    });
  }
});

describe("role-read-only: ordinary judge commands still pass", () => {
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

  it("blocks the judge from herdr, including the verbs that send input or change panes", async () => {
    blocked(await bash("judge", "herdr agent list"), "role-read-only");
    for (const command of [
      "herdr pane send-text w3:p1 hi",
      "herdr agent prompt j hi",
      "herdr agent send-keys j enter",
      "herdr pane split w1:p1",
      "herdr server stop",
    ]) {
      blocked(await bash("judge", command), "role-read-only");
    }
  });

  it("leaves the writer unbounded by the allowlist", async () => {
    allowed(await bash("writer", "make test"));
    allowed(await bash("writer", "/bin/bash -c 'touch a'"));
  });
});

const NOTIFY = [
  "node skills/bin/harness.mjs session notify w3:p1 --outcome done",
  "node skills/bin/harness.mjs session notify w3:p1 --outcome blocked",
];
const MALFORMED = [
  "node skills/bin/harness.mjs session notify w3:p1 --outcome merged",
  "node skills/bin/harness.mjs session notify w3:p1 --outcome 'done; rm -rf /'",
  "node skills/bin/harness.mjs session notify w3:p1 --outcome done extra",
  "node skills/bin/harness.mjs session notify 'w3:p1;rm' --outcome done",
  "node skills/bin/harness.mjs session notify w3:p1",
  "node other/harness.mjs session notify w3:p1 --outcome done",
];
const RAW = [
  "herdr pane send-text w3:p1 '[herdr:x] finished: RESULT done; summary in pane w3:p9'",
  "herdr pane send-text w3:p1 'rm -rf /'",
  "herdr pane send-keys w3:p1 enter",
];
/** Every spawned role's brief ends with the notice, so each bounded role may run exactly it. */
const ROLES: [string, string][] = [
  ["judge", "role-read-only"],
  ["reader", "role-read-only"],
];

describe("role-read-only: the finish notification and benign reads", () => {
  for (const [role, rule] of ROLES) {
    it(`${role}: may notify a pane only with an outcome of done or blocked`, async () => {
      for (const command of NOTIFY) {
        allowed(await bash(role, command));
      }
      for (const command of MALFORMED) {
        blocked(await bash(role, command), rule);
      }
    });

    it(`${role}: raw text or keys sent to a pane are refused with a finding that names session notify`, async () => {
      for (const command of RAW) {
        const result = await bash(role, command);
        blocked(result, "role-read-only");
        assert.ok(
          result.message.includes(
            "`node skills/bin/harness.mjs session notify <pane> --outcome done|blocked`",
          ),
          result.message,
        );
      }
    });
  }

  it("keeps herdr agent prompt refused for the judge: sessions are launched through session spawn (ADR 0078)", async () => {
    blocked(
      await bash("judge", "herdr agent prompt j 'do it'"),
      "role-read-only",
    );
  });

  it("allows an allowlisted read in the background: it still runs only an allowlisted command, so `&` adds no write", async () => {
    for (const role of ["judge"]) {
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

const READ_COMMANDS = [
  "sed -n 1,40p AGENTS.md",
  "sed -n s/a/b/gp AGENTS.md",
  "cd /Users/jun/.claude/projects/x",
  "paste - -",
  "cut -c1-200 AGENTS.md",
  "uniq -c",
  "wc -l AGENTS.md",
  "tr a-z A-Z",
  "awk '{print $1}' AGENTS.md",
  "T=/tmp/x",
];
const WRITE_COMMANDS = [
  "sed -i s/a/b/ AGENTS.md",
  "sed -n 1p AGENTS.md > out.txt",
  "cut -c1 AGENTS.md > out.txt",
  "uniq -c in.txt out.txt",
  "awk '{print > \"out\"}' AGENTS.md",
  "export X=1",
  "T=x > out.txt",
];
const ROLES_WITH_READS = ["reader", "judge"];

describe("role-read-only: the retro's read commands pass for every role the allowlist names", () => {
  for (const role of ROLES_WITH_READS) {
    it(`${role}: runs each read command and refuses each write form`, async () => {
      for (const command of READ_COMMANDS) {
        allowed(await bash(role, command));
      }
      for (const command of WRITE_COMMANDS) {
        blocked(await bash(role, command), "role-read-only");
      }
    });
  }

  it("the reader runs the retro scan, and a ledger option stays refused", async () => {
    for (const role of ["reader"]) {
      allowed(
        await bash(
          role,
          "node skills/bin/harness.mjs hook retro-scan --strict --since 2026-11-13",
        ),
      );
      blocked(
        await bash(
          role,
          "node skills/bin/harness.mjs hook retro-scan --ledger x.jsonl",
        ),
        "role-read-only",
      );
    }
  });

  it("judge still refuse the retro scan: their harness lists do not name it", async () => {
    for (const role of ["judge"]) {
      blocked(
        await bash(role, "node skills/bin/harness.mjs hook retro-scan"),
        "role-read-only",
      );
    }
  });
});
