#!/usr/bin/env node
// Harness evals: does each skill trigger for its task and not for near misses,
// and does principles-review flag each seeded violation and pass a clean diff?
// Plan: infra/plans/3-agent-harness.md (Step 9). Node standard library only.
//
// Usage: node .claude/evals/eval.mjs [--json]   (mise run eval-harness)
// Runs `claude -p` once per case, so it costs tokens: opt-in, never in ordinary
// runs. Sessions are not persisted, so evals never count toward the retrospective.
// Exits 1 when any case misses.

import { execFile, execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = fileURLToPath(new URL(".", import.meta.url));
/** Skill triggering depends on the model, so every run names it exactly. */
export const EVAL_MODEL = "claude-opus-5-5";
const CONCURRENCY = 4;
const SKILL_BUDGET_USD = "0.50";
const REVIEW_BUDGET_USD = "1.00";
const COMMON = ["-p", "--no-session-persistence", "--model", EVAL_MODEL];

/** Repository skills a stream-json transcript invoked, in order. */
export function invokedSkills(streamJson, repoSkills) {
  const invoked = [];
  for (const line of streamJson.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    for (const block of event?.message?.content ?? []) {
      const skill =
        block?.type === "tool_use" && block.name === "Skill"
          ? block.input?.skill
          : null;
      if (repoSkills.includes(skill) && !invoked.includes(skill))
        invoked.push(skill);
    }
  }
  return invoked;
}

/** A skill case hits when exactly the expected skill fires (none, for a near miss). */
export function gradeSkill(testCase, invoked) {
  const expected = testCase.expect ? [testCase.expect] : [];
  const hit =
    invoked.length === expected.length &&
    invoked.every((skill, i) => skill === expected[i]);
  return {
    hit,
    expected: testCase.expect ?? "none",
    got: invoked.join(", ") || "none",
  };
}

/** A seeded diff hits when the review names its rule; a clean diff hits on "No violations." */
export function gradeReview(testCase, result) {
  const clean = result.trim().startsWith("No violations.");
  const hit = testCase.expect
    ? !clean && result.toLowerCase().includes(testCase.expect.toLowerCase())
    : clean;
  const got = clean
    ? "No violations."
    : result.trim().split("\n")[0].slice(0, 160);
  return { hit, expected: testCase.expect ?? "No violations.", got };
}

/** Human-readable summary: hit count, then every miss with what happened instead. */
export function report(results, meta = {}) {
  const hits = results.filter((result) => result.hit).length;
  const lines = [`harness-eval: ${hits}/${results.length} hits`];
  if (meta.version) lines.push(`claude ${meta.version}, model ${meta.model}`);
  for (const result of results) {
    const mark = result.hit ? "hit " : "miss";
    lines.push(
      `${mark}  ${result.kind.padEnd(6)}  ${result.name}: expected ${result.expected}, got ${result.got}`,
    );
  }
  return lines.join("\n");
}

async function pool(tasks, size) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, worker),
  );
  return results;
}

/** Run every case through deps.claude(args) and grade it. Never throws on a failed run. */
export async function runEvals(deps) {
  const skillTasks = deps.skillCases.map((testCase) => async () => {
    const run = await deps.claude([
      ...COMMON,
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "plan",
      "--disallowedTools",
      "Edit,Write,NotebookEdit,Bash",
      "--max-budget-usd",
      SKILL_BUDGET_USD,
      testCase.prompt,
    ]);
    return {
      kind: "skill",
      name: testCase.prompt,
      ...gradeSkill(testCase, invokedSkills(run.stdout, deps.repoSkills)),
    };
  });
  const reviewTasks = deps.reviewCases.map((testCase) => async () => {
    const run = await deps.claude([
      ...COMMON,
      "--agent",
      "principles-review",
      "--output-format",
      "json",
      "--max-budget-usd",
      REVIEW_BUDGET_USD,
      `Review this diff. Judge only what it changes.\n\n${deps.readDiff(testCase.diff)}`,
    ]);
    let result = "";
    try {
      result = JSON.parse(run.stdout).result ?? "";
    } catch {
      result = "";
    }
    if (run.status !== 0 && !result) {
      const expected = testCase.expect ?? "No violations.";
      return {
        kind: "review",
        name: testCase.diff,
        hit: false,
        expected,
        got: `claude exited ${run.status}`,
      };
    }
    return {
      kind: "review",
      name: testCase.diff,
      ...gradeReview(testCase, result),
    };
  });
  return pool([...skillTasks, ...reviewTasks], CONCURRENCY);
}

function realClaude(root) {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        "claude",
        args,
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          timeout: 10 * 60 * 1000,
        },
        (error, stdout) => {
          const status = error
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0;
          resolve({ status, stdout: stdout ?? "" });
        },
      );
    });
}

async function main(argv) {
  const root = join(EVALS_DIR, "../..");
  const readJson = (name) =>
    JSON.parse(readFileSync(join(EVALS_DIR, name), "utf8"));
  const results = await runEvals({
    claude: realClaude(root),
    skillCases: readJson("skills.json"),
    reviewCases: readJson("principles-review.json"),
    readDiff: (name) =>
      readFileSync(join(EVALS_DIR, "principles-review", name), "utf8"),
    repoSkills: readdirSync(join(root, "skills")),
  });
  const meta = {
    version: execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(),
    model: EVAL_MODEL,
  };
  process.stdout.write(
    `${argv.includes("--json") ? JSON.stringify({ ...meta, results }, null, 2) : report(results, meta)}\n`,
  );
  return results.every((result) => result.hit) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
