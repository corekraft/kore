#!/usr/bin/env node
// Harness evals: does each skill trigger for its task and not for near misses,
// and does principles-review flag each seeded violation and pass a clean diff?
// Plan: infra/plans/3-agent-harness.md (Step 9). Node standard library only.
//
// Usage: node .claude/evals/eval.mjs [--json] [--kind skill,review,deny]
//        (mise run eval-harness)
// Runs `claude -p` once per case, so it costs tokens: opt-in, never in ordinary
// runs. Sessions are not persisted, so evals never count toward the retrospective.
// Exits 1 when any case misses.

import { execFile, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = fileURLToPath(new URL(".", import.meta.url));
/** Skill triggering depends on the model, so every run names it exactly. */
export const EVAL_MODEL = "claude-opus-5-5";
/** Triggering varies between runs, so each skill case is graded by majority. */
export const SKILL_SAMPLES = 3;
const KINDS = ["skill", "review", "deny"];

/** The case kinds to run: all by default, or those named by --kind a,b. */
export function selectedKinds(argv) {
  const index = argv.indexOf("--kind");
  if (index === -1) return [...KINDS];
  const kinds = (argv[index + 1] ?? "").split(",").filter(Boolean);
  if (kinds.length === 0) {
    throw new Error("--kind needs at least one of skill, review, deny");
  }
  for (const kind of kinds) {
    if (!KINDS.includes(kind)) {
      throw new Error(
        `unknown eval kind "${kind}"; use skill, review, or deny`,
      );
    }
  }
  return kinds;
}
const CONCURRENCY = 4;
const SKILL_BUDGET_USD = "0.50";
const REVIEW_BUDGET_USD = "1.00";
const DENY_BUDGET_USD = "0.30";
const HOOKS_OFF = JSON.stringify({ disableAllHooks: true });
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

/** A deny case hits when the permission system refused the exact command and no hook ran. */
export function gradeDeny(testCase, streamJson) {
  const expected = "denied by settings";
  let deniedBySettings = false;
  let guarded = false;
  for (const line of streamJson.split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    for (const block of event?.message?.content ?? []) {
      if (
        block?.type === "tool_result" &&
        JSON.stringify(block.content).includes("[guard:")
      ) {
        guarded = true;
      }
    }
    for (const denial of event?.permission_denials ?? []) {
      if (
        denial?.tool_name === "Bash" &&
        denial.tool_input?.command === testCase.command
      ) {
        deniedBySettings = true;
      }
    }
  }
  if (guarded)
    return {
      hit: false,
      expected,
      got: "guard hook still active, so the deny rule was not isolated",
    };
  return {
    hit: deniedBySettings,
    expected,
    got: deniedBySettings ? expected : "not denied",
  };
}

/** "add-command x2, none x1": how often each outcome occurred, most frequent first. */
function tally(outcomes) {
  const counts = new Map();
  for (const outcome of outcomes)
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => `${outcome} x${count}`)
    .join(", ");
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
  if (deps.skillCases.length > 0 && !deps.worktree) {
    throw new Error(
      "skill cases need deps.worktree: they allow edits, so each sample must run in a throwaway worktree",
    );
  }
  // Skill samples may edit files, so each runs in its own throwaway worktree.
  // Plan mode is not used: it hides skills that act before writing code.
  const skillRun = async (testCase) => {
    const worktree = await deps.worktree();
    try {
      return await deps.claude(
        [
          ...COMMON,
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          "acceptEdits",
          "--strict-mcp-config",
          "--max-budget-usd",
          SKILL_BUDGET_USD,
          testCase.prompt,
        ],
        { cwd: worktree.path },
      );
    } finally {
      await worktree.remove();
    }
  };
  const skillTasks = deps.skillCases.map((testCase) => async () => {
    const samples = await Promise.all(
      Array.from({ length: SKILL_SAMPLES }, () => skillRun(testCase)),
    );
    const grades = samples.map((run) =>
      gradeSkill(testCase, invokedSkills(run.stdout, deps.repoSkills)),
    );
    const hits = grades.filter((grade) => grade.hit).length;
    return {
      kind: "skill",
      name: testCase.prompt,
      hit: hits * 2 > grades.length,
      expected: grades[0].expected,
      got: tally(grades.map((grade) => grade.got)),
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
  // Deny cases switch every other gate off, so a broken rule must reach only
  // a stub: each runs in a throwaway worktree with stub commands first on PATH.
  const denyTasks = (deps.denyCases ?? []).map((testCase) => async () => {
    const sandbox = await deps.worktree({ stubs: true });
    let run;
    try {
      if (!sandbox.env?.PATH) {
        throw new Error(
          "deny cases need stub commands on PATH: deps.worktree({ stubs: true }) must return env.PATH",
        );
      }
      run = await deps.claude(
        [
          ...COMMON,
          "--settings",
          HOOKS_OFF,
          "--permission-mode",
          "bypassPermissions",
          "--output-format",
          "stream-json",
          "--verbose",
          "--max-budget-usd",
          DENY_BUDGET_USD,
          `This is a permission test; the command targets nothing that exists. Run exactly this shell command once with the Bash tool, then report what happened in one line: ${testCase.command}`,
        ],
        { cwd: sandbox.path, env: sandbox.env },
      );
    } finally {
      await sandbox.remove();
    }
    return {
      kind: "deny",
      name: testCase.command,
      ...gradeDeny(testCase, run.stdout),
    };
  });
  return pool([...skillTasks, ...reviewTasks, ...denyTasks], CONCURRENCY);
}

function realClaude(root) {
  return (args, options = {}) =>
    new Promise((resolve) => {
      execFile(
        "claude",
        args,
        {
          cwd: options.cwd ?? root,
          env: options.env ?? process.env,
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

/** A detached worktree of HEAD in a temporary directory; remove() deletes it. */
const STUBBED = ["kore", "minikube", "helm", "kubectl", "tofu", "terraform"];
const STUB = '#!/bin/sh\necho "eval stub: $(basename "$0") $*; nothing ran"\n';

/**
 * A detached worktree of HEAD in a temporary directory; remove() deletes it.
 * With stubs, cluster and infrastructure commands (and bin/kore) are harmless
 * scripts placed first on PATH.
 */
function realWorktree(root) {
  return async (options = {}) => {
    const parent = mkdtempSync(join(tmpdir(), "kore-eval-"));
    const path = join(parent, "repo");
    try {
      execFileSync("git", [
        "-C",
        root,
        "worktree",
        "add",
        "--detach",
        "--quiet",
        path,
        "HEAD",
      ]);
    } catch (error) {
      rmSync(parent, { recursive: true, force: true });
      throw error;
    }
    let env;
    if (options.stubs) {
      const stubs = join(path, ".eval-stubs");
      for (const dir of [stubs, join(path, "bin")])
        mkdirSync(dir, { recursive: true });
      for (const name of STUBBED)
        writeFileSync(join(stubs, name), STUB, { mode: 0o755 });
      writeFileSync(join(path, "bin", "kore"), STUB, { mode: 0o755 });
      env = { ...process.env, PATH: `${stubs}:${process.env.PATH ?? ""}` };
    }
    return {
      path,
      env,
      remove: async () => {
        execFileSync("git", [
          "-C",
          root,
          "worktree",
          "remove",
          "--force",
          path,
        ]);
        rmSync(parent, { recursive: true, force: true });
      },
    };
  };
}

async function main(argv) {
  const root = join(EVALS_DIR, "../..");
  const readJson = (name) =>
    JSON.parse(readFileSync(join(EVALS_DIR, name), "utf8"));
  const kinds = selectedKinds(argv);
  const cases = (kind, file) => (kinds.includes(kind) ? readJson(file) : []);
  const results = await runEvals({
    claude: realClaude(root),
    worktree: realWorktree(root),
    skillCases: cases("skill", "skills.json"),
    reviewCases: cases("review", "principles-review.json"),
    denyCases: cases("deny", "deny.json"),
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
