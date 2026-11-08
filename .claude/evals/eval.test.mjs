import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVAL_MODEL,
  SKILL_SAMPLES,
  selectedKinds,
  gradeDeny,
  gradeReview,
  gradeSkill,
  invokedSkills,
  report,
  runEvals,
} from "./eval.mjs";

const repoSkills = ["add-command", "handoff", "retro"];
const fakeWorktree = async (options) => ({
  path: "/tmp/kore-eval-wt",
  env: options?.stubs ? { PATH: "/tmp/kore-eval-wt/.eval-stubs" } : undefined,
  remove: async () => {},
});

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
    worktree: fakeWorktree,
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
  const skillArgs = calls.find((args) => args.includes("stream-json"));
  const reviewArgs = calls.find((args) => args.includes("--agent"));
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
    worktree: fakeWorktree,
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
    worktree: fakeWorktree,
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

test("a skill case samples several runs and is a hit only when most of them hit", async () => {
  const outcomes = [stream, "", stream];
  const calls = [];
  const results = await runEvals({
    claude: async (args) => {
      calls.push(args);
      return { status: 0, stdout: outcomes[calls.length - 1] ?? "" };
    },
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [],
    readDiff: () => "",
    repoSkills,
    worktree: fakeWorktree,
  });
  assert.equal(SKILL_SAMPLES, 3);
  assert.equal(calls.length, SKILL_SAMPLES);
  assert.equal(results.length, 1);
  assert.equal(results[0].hit, true);
  assert.equal(results[0].got, "add-command x2, none x1");

  const once = [stream, "", ""];
  let call = 0;
  const [missed] = await runEvals({
    claude: async () => ({ status: 0, stdout: once[call++] }),
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [],
    readDiff: () => "",
    repoSkills,
    worktree: fakeWorktree,
  });
  assert.equal(missed.hit, false);
  assert.equal(missed.got, "none x2, add-command x1");
});

const denied = (command, extra = []) =>
  [
    ...extra,
    {
      type: "result",
      permission_denials: [{ tool_name: "Bash", tool_input: { command } }],
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");

test("gradeDeny is a hit only when the permission system, not the guard hook, refused the command", () => {
  const command =
    "helm uninstall kore-eval-absent --kube-context kore-eval-absent";
  assert.equal(gradeDeny({ command }, denied(command)).hit, true);

  const ran = JSON.stringify({ type: "result", permission_denials: [] });
  assert.deepEqual(gradeDeny({ command }, ran), {
    hit: false,
    expected: "denied by settings",
    got: "not denied",
  });

  const guarded = denied(command, [
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", content: "[guard:destructive] refused" },
        ],
      },
    },
  ]);
  assert.equal(gradeDeny({ command }, guarded).hit, false);
  assert.match(gradeDeny({ command }, guarded).got, /guard hook still active/);
});

test("deny cases run with every hook disabled and permissions bypassed, so only deny rules can refuse", async () => {
  const command = "tofu destroy -input=false";
  const calls = [];
  const [result] = await runEvals({
    claude: async (args) => {
      calls.push(args);
      return { status: 0, stdout: denied(command) };
    },
    skillCases: [],
    reviewCases: [],
    denyCases: [{ command }],
    readDiff: () => "",
    repoSkills,
    worktree: fakeWorktree,
  });
  const [args] = calls;
  assert.equal(
    args[args.indexOf("--settings") + 1],
    '{"disableAllHooks":true}',
  );
  assert.equal(
    args[args.indexOf("--permission-mode") + 1],
    "bypassPermissions",
  );
  assert.ok(args.includes("--no-session-persistence"));
  assert.match(args.at(-1), /tofu destroy -input=false/);
  assert.deepEqual([result.kind, result.hit], ["deny", true]);
});

test("selectedKinds runs every kind by default and only the named kinds with --kind", () => {
  assert.deepEqual(selectedKinds([]), ["skill", "review", "deny"]);
  assert.deepEqual(selectedKinds(["--json"]), ["skill", "review", "deny"]);
  assert.deepEqual(selectedKinds(["--kind", "deny,skill"]), ["deny", "skill"]);
  assert.throws(
    () => selectedKinds(["--kind", "lint"]),
    /unknown eval kind "lint"; use skill, review, or deny/,
  );
});

test("each skill sample runs in its own throwaway worktree that is removed afterwards, with edits allowed only there", async () => {
  const created = [];
  const removed = [];
  const calls = [];
  await runEvals({
    claude: async (args, options) => {
      calls.push({ args, cwd: options?.cwd });
      return { status: 1, stdout: "" };
    },
    skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
    reviewCases: [],
    readDiff: () => "",
    repoSkills,
    worktree: async () => {
      const path = `/tmp/kore-eval-wt-${created.length}`;
      created.push(path);
      return { path, remove: async () => removed.push(path) };
    },
  });
  assert.equal(created.length, SKILL_SAMPLES);
  assert.deepEqual(
    removed.sort(),
    [...created].sort(),
    "every worktree is removed, even after a failed run",
  );
  assert.deepEqual(calls.map((call) => call.cwd).sort(), [...created].sort());
  for (const { args } of calls) {
    assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
    assert.ok(
      args.includes("--strict-mcp-config"),
      "no MCP server can act outside the worktree",
    );
    assert.ok(
      !args.includes("plan"),
      "plan mode hides skills that act before writing code",
    );
  }
});

test("skill cases refuse to run without a worktree, rather than allowing edits in the repository", async () => {
  await assert.rejects(
    runEvals({
      claude: async () => ({ status: 0, stdout: "" }),
      skillCases: [{ prompt: "Add a flag", expect: "add-command" }],
      reviewCases: [],
      readDiff: () => "",
      repoSkills,
    }),
    /skill cases need deps\.worktree/,
  );
});

test("deny cases run in a throwaway worktree with stub commands first on PATH, so a broken rule runs only a stub", async () => {
  const command = "kore eval-absent destroy --yes --purge-data";
  const calls = [];
  const removed = [];
  const [result] = await runEvals({
    claude: async (args, options) => {
      calls.push(options);
      return { status: 0, stdout: denied(command) };
    },
    skillCases: [],
    reviewCases: [],
    denyCases: [{ command }],
    readDiff: () => "",
    repoSkills,
    worktree: async (options) => ({
      path: "/tmp/kore-eval-deny",
      env: options?.stubs
        ? { PATH: "/tmp/kore-eval-deny/.eval-stubs:/usr/bin" }
        : undefined,
      remove: async () => removed.push("/tmp/kore-eval-deny"),
    }),
  });
  assert.equal(result.hit, true);
  assert.equal(calls[0].cwd, "/tmp/kore-eval-deny");
  assert.match(calls[0].env.PATH, /^\/tmp\/kore-eval-deny\/\.eval-stubs:/);
  assert.deepEqual(removed, ["/tmp/kore-eval-deny"]);
});

test("deny cases refuse to run without stub commands, rather than risk a real destructive command", async () => {
  await assert.rejects(
    runEvals({
      claude: async () => ({ status: 0, stdout: "" }),
      skillCases: [],
      reviewCases: [],
      denyCases: [{ command: "tofu destroy -input=false" }],
      readDiff: () => "",
      repoSkills,
      worktree: async () => ({ path: "/tmp/x", remove: async () => {} }),
    }),
    /deny cases need stub commands on PATH/,
  );
});

test("selectedKinds refuses an empty --kind instead of running nothing and passing", () => {
  for (const argv of [["--kind"], ["--kind", ","], ["--kind", ""]]) {
    assert.throws(
      () => selectedKinds(argv),
      /--kind needs at least one of skill, review, deny/,
      argv.join(" "),
    );
  }
});
