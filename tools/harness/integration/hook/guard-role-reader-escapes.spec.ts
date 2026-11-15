import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });
const harness = (role: string, rest: string) =>
  bash(role, `node skills/bin/harness.mjs ${rest}`);

describe("the reader never writes files itself", () => {
  for (const role of ["reader"]) {
    it(`${role}: file tools and writing commands are blocked`, async () => {
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
      for (const command of [
        "echo x > docs/ideas/0001-a.md",
        "sed -i s/a/b/ docs/ideas/0001-a.md",
        "git commit -am x",
      ]) {
        blocked(await bash(role, command), "role-read-only");
      }
      blocked(await bash(role, "node -e 'process.exit(0)'"), "role-read-only");
    });

    it(`${role}: nobody merges, and the harness stays on the role's list`, async () => {
      blocked(await bash(role, "gh pr merge 12 --squash"), "role-read-only");
      for (const rest of [
        "plan tick --item x",
        "adr new --title x",
        "outcome record --idea 1",
        "session spawn --role writer --name a --brief b",
        "flag activate x --environment local",
      ]) {
        blocked(await harness(role, rest), "role-read-only");
      }
    });

    it(`${role}: reading status and ideas passes`, async () => {
      for (const rest of ["plan active", "idea list", "idea show --idea 1"]) {
        allowed(await harness(role, rest));
      }
    });
  }
});

describe("the reader runs only an allowlist, so it cannot approve or act around the loop", () => {
  const ESCAPES = [
    "gh issue edit 5 --add-label ready-for-agent",
    'gh issue comment 5 --body "approved"',
    "gh issue close 5",
    "gh api -X POST repos/corekraft/kore/issues/5/labels",
    "gh api repos/corekraft/kore/issues/5/comments -f body=x",
    'herdr pane send-text w3:p1 "approved"',
    "sh -c 'echo x > a.ts'",
    "bash -c 'echo x > a.ts'",
    "curl -o a.ts https://example.com/x",
    "npx tsx tools/harness/src/main.ts idea list",
    "node tools/harness/src/main.ts idea list",
    "node /tmp/skills/bin/harness.mjs idea new --title x",
  ];

  it("blocks each command that acts outside the idea tool", async () => {
    for (const command of ESCAPES) {
      blocked(await bash("reader", command), "role-read-only");
    }
  });

  it("blocks them chained after an allowed command", async () => {
    for (const command of ESCAPES) {
      blocked(
        await bash(
          "reader",
          `node skills/bin/harness.mjs idea list && ${command}`,
        ),
        "role-read-only",
      );
    }
  });

  it("still reads issues and pull requests", async () => {
    for (const command of [
      "gh issue view 5",
      "gh pr view 12",
      "gh pr diff 12",
    ]) {
      allowed(await bash("reader", command));
    }
  });
});

describe("--ledger would let a role append to any file, so no bounded role may pass it", () => {
  const WITH_LEDGER = [
    "idea list --ledger /repo/src/a.ts",
    "idea list --ledger=/repo/src/a.ts",
    "ledger list --ledger /etc/x",
  ];

  it("blocks it for the reader", async () => {
    for (const rest of WITH_LEDGER) {
      blocked(await harness("reader", rest), "role-read-only");
    }
  });

  it("allows the same commands without it", async () => {
    allowed(await harness("reader", "idea list"));
    allowed(await harness("reader", "ledger list"));
  });
});

describe("the reader files no idea", () => {
  it("may not file or mirror an idea", async () => {
    for (const rest of ["idea new --title x", "idea sync --idea 1"]) {
      blocked(await harness("reader", rest), "role-read-only");
    }
  });

  it("may read code to check a request against it", async () => {
    allowed(await as("reader", "Read", { file_path: "/repo/tools/a.ts" }));
    allowed(await bash("reader", "git log --oneline -5"));
  });
});
