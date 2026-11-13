// Shared fixtures for the guardrail request and status specs.
import { readFileSync } from "node:fs";
import { run } from "../cli/index.js";
import { LEDGER, linked, type Harness } from "../outcome/outcome-support.js";
import { fixtures } from "../hook/retro-scan-support.js";
import { FakeRunner } from "../runtime/runner-support.js";
import { gitHistory, type FakeCommit } from "./history-support.js";
import { INVENTORY_PATH } from "./index.js";

const entry = (rule: string, mode: string, extra = {}) => ({
  rule,
  kind: "bash",
  mode,
  owner: "guard.ts",
  ...extra,
});

export const INVENTORY = JSON.stringify({
  guardrails: [
    entry("image-digest", "audit"),
    entry("sample-audit", "audit"),
    entry("unquoted-glob", "audit"),
    entry("enforced-rule", "enforce"),
    entry("kubectl-context", "enforce"),
    entry("deny-iac-destroy", "enforce", { deny: ["Bash(tofu destroy:*)"] }),
    entry("main-ruleset-pull-request", "audit", { kind: "ruleset" }),
    entry("main-ruleset-deletion", "enforce", { kind: "ruleset" }),
  ],
});

/** Answers git from these commits (newest first), and `rev-parse` as a checkout of /repo; every other call goes on to the fake gh. */
export function withGit(h: Harness, commits: readonly FakeCommit[] = []) {
  const git = new FakeRunner([
    ...gitHistory(commits),
    {
      match: (c, a) => c === "git" && a.includes("--git-common-dir"),
      result: { stdout: "/repo/.git\n" },
    },
  ]);
  const others = h.runner.run.bind(h.runner);
  h.runner.run = (command, args, options) => {
    if (command !== "git") {
      return others(command, args, options);
    }
    h.runner.calls.push({ command, args, options });
    return git.run(command, args, options);
  };
}

export async function ready(overrides = {}) {
  const { h, issue } = await linked(overrides);
  withGit(h);
  let n = 0;
  h.deps.ids = { next: () => `req-${++n}` };
  h.set(INVENTORY_PATH, INVENTORY);
  for (const name of ["alpha", "bravo", "charlie"]) {
    h.set(
      `transcripts/${name}.jsonl`,
      readFileSync(`${fixtures}${name}.jsonl`, "utf8"),
    );
  }
  return { h, issue };
}

export const request = (
  h: Harness,
  rule: string,
  to: string,
  extra: string[] = [],
) =>
  run(
    [
      "guardrail",
      "request",
      "--rule",
      rule,
      "--to",
      to,
      "--idea",
      "1",
      "--dir",
      "/repo/transcripts",
      "--ledger",
      LEDGER,
      "--json",
      ...extra,
    ],
    h.deps,
  );

export const ledgerEvents = (h: Harness) =>
  (h.get(".kore/state/ledger.jsonl") ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const REPO = "corekraft/kore";

/** Answers GitHub's ruleset API: a candidate ruleset (id 8) and one rule suite where its `pull_request` rule failed in evaluate. */
export function withRulesetInsights(h: Harness) {
  const others = h.runner.run.bind(h.runner);
  const reply = (value: unknown) =>
    Promise.resolve({ stdout: JSON.stringify(value), stderr: "", code: 0 });
  h.runner.run = (command, args, options) => {
    const path = args[0] === "api" ? (args[1] ?? "") : "";
    if (path === `repos/${REPO}/rulesets`) {
      return reply([{ id: 8, name: "main-candidate" }]);
    }
    if (path.startsWith(`repos/${REPO}/rulesets/rule-suites?`)) {
      return reply([
        { id: 1, evaluation_result: "fail", actor_name: "a" },
        { id: 2, evaluation_result: "pass" },
      ]);
    }
    if (path === `repos/${REPO}/rulesets/rule-suites/1`) {
      return reply({
        rule_evaluations: [
          {
            rule_source: { id: 8, name: "main-candidate" },
            enforcement: "evaluate",
            result: "fail",
            rule_type: "pull_request",
          },
        ],
      });
    }
    return others(command, args, options);
  };
  return ["--repo", REPO, "--target", "main"];
}
