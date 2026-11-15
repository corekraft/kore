import { describe, it } from "vitest";
import { allowed, blocked, decide } from "../../src/testing/index.js";

const as = (agent_type: string, tool_name: string, tool_input: object) =>
  decide({ agent_type, tool_name, tool_input });
const bash = (role: string, command: string) => as(role, "Bash", { command });
const harness = (role: string, rest: string) =>
  bash(role, `node skills/bin/harness.mjs ${rest}`);

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

  for (const role of ["challenger"]) {
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
  const finding = (role: string) =>
    ["challenger"].includes(role) ? "role-no-code" : "role-read-only";

  for (const role of ["reader", "refiner", "challenger"]) {
    it(`${role}: every assigned form is blocked`, async () => {
      for (const command of ASSIGNED) {
        blocked(await bash(role, command), finding(role));
      }
    });
  }

  it("a variable name inside an argument is not an assignment", async () => {
    allowed(await bash("reader", "grep KORE_ROOT=x README.md"));
    allowed(await bash("refiner", "echo KORE_ROOT=x"));
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

  for (const role of ["reader", "refiner", "challenger"]) {
    it(`${role}: each is blocked`, async () => {
      const rule = ["challenger"].includes(role)
        ? "role-no-code"
        : "role-read-only";
      for (const command of PROGRAM_OPTIONS) {
        blocked(await bash(role, command), rule);
      }
    });
  }

  for (const role of ["reader", "refiner"]) {
    it(`${role}: a plain git diff still passes`, async () => {
      allowed(await bash(role, "git diff HEAD~1"));
    });
  }
});
