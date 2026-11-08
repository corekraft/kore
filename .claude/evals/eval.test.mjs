import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVAL_MODEL,
  gradeReview,
  gradeSkill,
  invokedSkills,
  report,
  runEvals,
} from "./eval.mjs";

const repoSkills = ["add-command", "handoff", "retro"];

const stream = [
  { type: "system", subtype: "init" },
  {
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Loading the skill." },
        { type: "tool_use", name: "Skill", input: { skill: "add-command" } },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Skill",
          input: { skill: "artifact-design" },
        },
      ],
    },
  },
  {
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
  },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

test("invokedSkills keeps only repository skills the session invoked, ignoring other tools and bad lines", () => {
  assert.deepEqual(invokedSkills(`${stream}\nnot json\n`, repoSkills), [
    "add-command",
  ]);
  assert.deepEqual(invokedSkills("", repoSkills), []);
});

test("gradeSkill is a hit only when exactly the expected skill fires", () => {
  assert.equal(
    gradeSkill({ expect: "add-command" }, ["add-command"]).hit,
    true,
  );
  assert.equal(gradeSkill({ expect: "add-command" }, []).hit, false);
  assert.equal(gradeSkill({ expect: "add-command" }, ["retro"]).hit, false);
  assert.equal(gradeSkill({ expect: null }, []).hit, true);
  assert.equal(gradeSkill({ expect: null }, ["handoff"]).hit, false);
});

test("gradeReview needs the seeded rule named, and a clean diff to pass with No violations.", () => {
  const seeded = { expect: "Errors are actionable" };
  assert.equal(
    gradeReview(seeded, "app.ts:131 | Errors are actionable | ...").hit,
    true,
  );
  assert.equal(
    gradeReview(seeded, "app.ts:131 | errors are ACTIONABLE | ...").hit,
    true,
  );
  assert.equal(
    gradeReview(seeded, "No violations. Checked: Errors are actionable").hit,
    false,
  );
  assert.equal(
    gradeReview(seeded, "app.ts:1 | Pin everything | ...").hit,
    false,
  );
  assert.equal(
    gradeReview({ expect: null }, "No violations.\nRules checked: ...").hit,
    true,
  );
  assert.equal(
    gradeReview({ expect: null }, "app.ts:1 | One owner per resource").hit,
    false,
  );
});

test("report counts hits and lists each miss with what fired instead", () => {
  const text = report([
    {
      kind: "skill",
      name: "Add a flag",
      hit: true,
      expected: "add-command",
      got: "add-command",
    },
    {
      kind: "skill",
      name: "Explain the guard",
      hit: false,
      expected: "none",
      got: "retro",
    },
    {
      kind: "review",
      name: "clean.diff",
      hit: true,
      expected: "No violations.",
      got: "No violations.",
    },
  ]);
  assert.match(text, /2\/3 hits/);
  assert.match(
    text,
    /miss\s+skill\s+Explain the guard: expected none, got retro/,
  );
  assert.doesNotMatch(text, /miss\s+skill\s+Add a flag/);
});

test("runEvals runs every case without persisting sessions, read-only, and within a budget", async () => {
  const calls = [];
  const claude = async (args) => {
    calls.push(args);
    if (args.includes("--agent"))
      return {
        status: 0,
        stdout: JSON.stringify({ result: "No violations." }),
      };
    return { status: 0, stdout: stream };
  };
  const results = await runEvals({
    claude,
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [{ diff: "clean.diff", expect: null }],
    readDiff: (name) => `diff for ${name}`,
    repoSkills,
  });

  assert.deepEqual(
    results.map((result) => [result.kind, result.hit]),
    [
      ["skill", true],
      ["review", true],
    ],
  );
  for (const args of calls) {
    assert.ok(args.includes("--no-session-persistence"), args.join(" "));
    assert.ok(args.includes("--max-budget-usd"), args.join(" "));
  }
  const [skillArgs, reviewArgs] = calls;
  assert.ok(skillArgs.includes("plan"), "skill cases run in plan mode");
  assert.ok(
    skillArgs.includes("Edit,Write,NotebookEdit,Bash"),
    "skill cases cannot edit or run shell",
  );
  assert.deepEqual(
    reviewArgs.slice(
      reviewArgs.indexOf("--agent"),
      reviewArgs.indexOf("--agent") + 2,
    ),
    ["--agent", "principles-review"],
  );
  assert.match(reviewArgs.at(-1), /diff for clean\.diff/);
});

test("runEvals reports a failed claude run as a miss instead of throwing", async () => {
  const results = await runEvals({
    claude: async () => ({ status: 1, stdout: "" }),
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [{ diff: "one-owner.diff", expect: "One owner per resource" }],
    readDiff: () => "",
    repoSkills,
  });
  assert.deepEqual(
    results.map((result) => result.hit),
    [false, false],
  );
  assert.match(results[1].got, /claude exited 1/);
});

test("every run uses the pinned model, and the report names the model and CLI version", async () => {
  const calls = [];
  await runEvals({
    claude: async (args) => {
      calls.push(args);
      return { status: 0, stdout: "" };
    },
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [{ diff: "clean.diff", expect: null }],
    readDiff: () => "",
    repoSkills,
  });
  for (const args of calls) {
    assert.equal(args[args.indexOf("--model") + 1], EVAL_MODEL);
  }
  assert.match(EVAL_MODEL, /^claude-[a-z]+-\d/);
  assert.match(
    report([], { version: "2.1.319 (Claude Code)", model: EVAL_MODEL }),
    new RegExp(`claude 2\\.1\\.319 \\(Claude Code\\), model ${EVAL_MODEL}`),
  );
});
