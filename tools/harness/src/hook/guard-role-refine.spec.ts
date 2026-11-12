import { describe, it } from "vitest";
import { allowed, blocked, decide } from "./guard-support.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });
const harness = (role: string, rest: string) =>
  bash(role, `node skills/bin/harness.mjs ${rest}`);

const ROLES = ["refiner", "challenger"];

describe("refiner and challenger never write files themselves", () => {
  for (const role of ROLES) {
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
      blocked(
        await bash(role, "node -e 'process.exit(0)'"),
        role === "refiner" ? "role-read-only" : "role-no-code",
      );
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
        blocked(
          await harness(role, rest),
          role === "refiner" ? "role-read-only" : "role-no-code",
        );
      }
    });

    it(`${role}: reading status and ideas passes`, async () => {
      for (const rest of ["plan active", "idea list", "idea show --idea 1"]) {
        allowed(await harness(role, rest));
      }
    });
  }
});

describe("the refiner runs only an allowlist, so it cannot approve or act around the loop", () => {
  const ESCAPES = [
    "gh issue edit 5 --add-label ready-for-agent",
    'gh issue comment 5 --body "<!-- harness-challenge idea=0001 round=1 -->"',
    "gh issue close 5",
    "gh api -X POST repos/corekraft/kore/issues/5/labels",
    "gh api repos/corekraft/kore/issues/5/comments -f body=x",
    'herdr pane send-text w3:p1 "approved"',
    "sh -c 'echo x > a.ts'",
    "bash -c 'echo x > a.ts'",
    "curl -o a.ts https://example.com/x",
    "npx tsx tools/harness/src/main.ts idea challenge --idea 1 --approve",
    "node tools/harness/src/main.ts idea challenge --idea 1 --approve",
    "node /tmp/skills/bin/harness.mjs idea new --title x",
  ];

  it("blocks each command that acts outside the idea tool", async () => {
    for (const command of ESCAPES) {
      blocked(await bash("refiner", command), "role-read-only");
    }
  });

  it("blocks them chained after an allowed command", async () => {
    for (const command of ESCAPES) {
      blocked(
        await bash(
          "refiner",
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
      allowed(await bash("refiner", command));
    }
  });
});

describe("--ledger would let a role append to any file, so no bounded role may pass it", () => {
  const WITH_LEDGER = [
    "idea challenge --idea 1 --approve --ledger /repo/src/a.ts",
    "idea challenge --idea 1 --approve --ledger=/repo/src/a.ts",
    "ledger list --ledger /etc/x",
  ];

  it("blocks it for the challenger, refiner, concierge and orchestrator", async () => {
    for (const role of ["challenger", "refiner", "concierge", "orchestrator"]) {
      for (const rest of WITH_LEDGER) {
        const verdict = await harness(role, rest);
        blocked(
          verdict,
          ["challenger", "concierge"].includes(role)
            ? "role-no-code"
            : "role-read-only",
        );
      }
    }
  });

  it("allows the same commands without it", async () => {
    allowed(await harness("challenger", "idea challenge --idea 1 --approve"));
    allowed(await harness("orchestrator", "ledger list"));
  });
});

describe("the refiner writes an idea only through the idea tool", () => {
  it("may file and mirror an idea", async () => {
    for (const rest of [
      'idea new --title "x" --hypothesis h --expected-outcome e --measurement m --safety-pattern feature-flagged',
      "idea sync --idea 1",
    ]) {
      allowed(await harness("refiner", rest));
    }
  });

  it("may not challenge an idea, the one job it must not do for itself", async () => {
    blocked(
      await harness("refiner", "idea challenge --idea 1 --approve"),
      "role-read-only",
    );
  });

  it("may read code to check a request against it", async () => {
    allowed(await as("refiner", "Read", { file_path: "/repo/tools/a.ts" }));
    allowed(await bash("refiner", "git log --oneline -5"));
  });
});

describe("role-no-code: the challenger reviews ideas, ADRs and plans, never code", () => {
  it("may challenge an idea, by approving or with objections on stdin", async () => {
    allowed(await harness("challenger", "idea challenge --idea 1 --approve"));
    allowed(
      await bash(
        "challenger",
        'echo "No baseline." | node skills/bin/harness.mjs idea challenge --idea 1',
      ),
    );
  });

  it("may not file or sync an idea", async () => {
    blocked(await harness("challenger", "idea new --title x"), "role-no-code");
    blocked(await harness("challenger", "idea sync --idea 1"), "role-no-code");
  });

  it("may read plans, ADRs, ideas and the glossary", async () => {
    for (const file_path of [
      "/repo/infra/plans/11-agent-delivery-loop.md",
      "/repo/docs/decisions/0078-agent-roles-run-as-herdr-panes.md",
      "/repo/docs/ideas/0001-a.md",
      "/repo/GLOSSARY.md",
    ]) {
      allowed(await as("challenger", "Read", { file_path }));
    }
  });

  it("is blocked from reading code, whichever tool it uses", async () => {
    blocked(
      await as("challenger", "Read", { file_path: "/repo/tools/a.ts" }),
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
    for (const command of [
      "cat tools/harness/src/main.ts",
      "git diff main...HEAD",
      "git show HEAD",
      "gh pr diff 12",
      "grep -r foo tools",
    ]) {
      blocked(await bash("challenger", command), "role-no-code");
    }
  });

  it("may read the issue queue and history", async () => {
    for (const command of [
      "gh issue view 192",
      "gh pr view 12",
      "git log --oneline -5",
    ]) {
      allowed(await bash("challenger", command));
    }
  });
});

describe("role-no-code: a path with .. cannot step out of the readable folders", () => {
  const TRAVERSALS = [
    { tool: "Read", input: { file_path: "/repo/docs/../tools/a.ts" } },
    { tool: "Read", input: { file_path: "docs/../tools/a.ts" } },
    { tool: "Grep", input: { pattern: "x", path: "/repo/docs/.." } },
    { tool: "Grep", input: { pattern: "x", path: "infra/plans/../../tools" } },
    {
      tool: "Glob",
      input: { pattern: "../tools/**/*.ts", path: "/repo/docs" },
    },
    {
      tool: "Glob",
      input: { pattern: "/repo/tools/**/*.ts", path: "/repo/docs" },
    },
    {
      tool: "Glob",
      input: { pattern: "**/*.ts", path: "/repo/docs/../tools" },
    },
  ];

  for (const role of ["challenger", "concierge"]) {
    it(`${role}: blocked whichever file tool names it`, async () => {
      for (const { tool, input } of TRAVERSALS) {
        blocked(await as(role, tool, input), "role-no-code");
      }
    });

    it(`${role}: a real path under docs still passes`, async () => {
      allowed(await as(role, "Read", { file_path: "/repo/docs/index.md" }));
      allowed(
        await as(role, "Glob", {
          pattern: "*.md",
          path: "/repo/docs/decisions",
        }),
      );
      allowed(
        await as(role, "Read", { file_path: "/repo/docs/../GLOSSARY.md" }),
      );
    });
  }
});
