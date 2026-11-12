#!/usr/bin/env node
// Harness evals: does each skill trigger for its task and not for near misses,
// and does principles-review flag each seeded violation and pass a clean diff?
// Plan: infra/plans/3-agent-harness.md (Step 9). Node standard library only.
//
// Usage: node .claude/evals/eval.mjs [--json] [--kind skill,review,deny] [--no-history]
//        node .claude/evals/eval.mjs --trend [--json]   (no model calls)
//        (mise run eval-harness)
// Runs `claude -p` once per case, so it costs tokens: opt-in, never in ordinary
// runs. Sessions are not persisted, so evals never count toward the retrospective.
// Exits 1 when any case misses.

import { execFile, execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = fileURLToPath(new URL(".", import.meta.url));
/** Skill triggering depends on the model, so every run names it exactly. */
export const EVAL_MODEL = "claude-opus-5-5";
/** Triggering varies between runs, so each skill case is graded by majority. */
export const SKILL_SAMPLES = 3;
const HISTORY_FILE = join(EVALS_DIR, "history.jsonl");
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

/** A review or deny case is one sample: it hits once or not at all. */
const single = (grade) => ({
  ...grade,
  hits: grade.hit ? 1 : 0,
  samples: 1,
});

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
      hits,
      samples: grades.length,
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
        hits: 0,
        samples: 1,
        expected,
        got: `claude exited ${run.status}`,
      };
    }
    return {
      kind: "review",
      name: testCase.diff,
      ...single(gradeReview(testCase, result)),
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
      ...single(gradeDeny(testCase, run.stdout)),
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
const STUBBED = [
  "kore",
  "minikube",
  "k3d",
  "helm",
  "kubectl",
  "tofu",
  "terraform",
];
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

const TREND_WINDOW = 5;
const rateOf = (runs) => {
  const samples = runs.reduce((sum, run) => sum + run.samples, 0);
  return samples === 0
    ? 0
    : runs.reduce((sum, run) => sum + run.hits, 0) / samples;
};

/**
 * Per case: its hit rate over the last five runs that included it, the rate
 * over the five before, and whether it fell. With fewer than ten runs there is
 * nothing to compare, so a case is never reported as regressed.
 */
export function trend(history) {
  const byCase = new Map();
  for (const entry of history) {
    for (const item of entry.cases ?? []) {
      const key = `${item.kind}\u0000${item.name}`;
      if (!byCase.has(key)) byCase.set(key, { ...item, runs: [] });
      byCase.get(key).runs.push(item);
    }
  }
  return [...byCase.values()].map(({ kind, name, runs }) => {
    const recent = runs.slice(-TREND_WINDOW);
    const before = runs.slice(-2 * TREND_WINDOW, -TREND_WINDOW);
    const rate = rateOf(recent);
    const previous = before.length === TREND_WINDOW ? rateOf(before) : null;
    return {
      kind,
      name,
      runs: runs.length,
      rate,
      previous,
      regressed: previous !== null && rate < previous,
    };
  });
}

/** One line per case; a regression is spelled out. */
export function formatTrend(rows) {
  if (rows.length === 0) return "eval history is empty";
  const percent = (rate) => `${Math.round(rate * 100)}%`;
  return rows
    .map((row) => {
      const window = Math.min(row.runs, TREND_WINDOW);
      const base = `${row.name}: ${percent(row.rate)} over last ${window} run${window === 1 ? "" : "s"}`;
      if (row.previous === null) return base;
      return row.regressed
        ? `${base}, was ${percent(row.previous)}, regressed`
        : `${base}, was ${percent(row.previous)}`;
    })
    .join("\n");
}

/** The live dependencies: real `claude` runs and worktrees of this repository. */
function realDeps() {
  const root = join(EVALS_DIR, "../..");
  return {
    claude: realClaude(root),
    worktree: realWorktree(root),
    version: () =>
      execFileSync("claude", ["--version"], { encoding: "utf8" }).trim(),
    readJson: (name) => JSON.parse(readFileSync(join(EVALS_DIR, name), "utf8")),
    readDiff: (name) =>
      readFileSync(join(EVALS_DIR, "principles-review", name), "utf8"),
    repoSkills: readdirSync(join(root, "skills")),
    write: (text) => process.stdout.write(text),
    now: () => new Date(),
    historyFile: HISTORY_FILE,
  };
}

/** Every dependency is injected, so tests never reach a real `claude`. */
export async function main(argv, deps) {
  if (argv.includes("--trend")) {
    const history = existsSync(deps.historyFile)
      ? readFileSync(deps.historyFile, "utf8")
          .split("\n")
          .map((text, index) => ({ text, number: index + 1 }))
          .filter(({ text }) => text)
          .map(({ text, number }) => {
            try {
              return JSON.parse(text);
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
              throw new Error(
                `${basename(deps.historyFile)}:${number} is not valid JSON; repair or delete that line`,
              );
            }
          })
      : [];
    const rows = trend(history);
    deps.write(
      `${argv.includes("--json") ? JSON.stringify(rows, null, 2) : formatTrend(rows)}\n`,
    );
    return 0;
  }
  const kinds = selectedKinds(argv);
  const cases = (kind, file) =>
    kinds.includes(kind) ? deps.readJson(file) : [];
  const results = await runEvals({
    claude: deps.claude,
    worktree: deps.worktree,
    skillCases: cases("skill", "skills.json"),
    reviewCases: cases("review", "principles-review.json"),
    denyCases: cases("deny", "deny.json"),
    readDiff: deps.readDiff,
    repoSkills: deps.repoSkills,
  });
  const meta = { version: deps.version(), model: EVAL_MODEL };
  if (!argv.includes("--no-history")) {
    const entry = {
      date: deps.now().toISOString(),
      source: "run",
      claude: meta.version,
      model: meta.model,
      kinds,
      cases: results.map(({ kind, name, hits, samples }) => ({
        kind,
        name,
        hits,
        samples,
      })),
    };
    appendFileSync(deps.historyFile, `${JSON.stringify(entry)}\n`);
  }
  deps.write(
    `${argv.includes("--json") ? JSON.stringify({ ...meta, results }, null, 2) : report(results, meta)}\n`,
  );
  return results.every((result) => result.hit) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2), realDeps());
}
