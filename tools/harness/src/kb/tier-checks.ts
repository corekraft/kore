// A model-tier idea's frontmatter (#218): cost and judge send-backs are declared together.
// Docs: infra/plans/12-self-improving-loop.md

import {
  TIER_COST_METRIC,
  TIER_FIELDS,
  TIER_GUARD_METRIC,
} from "../idea/index.js";
import { finding, type Finding } from "./markdown.js";

type Keys = Map<string, { value: string; line: number }>;

type Entry = { value: string; line: number };

/** The guard metric of a tier idea: present, the judge send-backs metric, and still in the flow report. */
function guardProblem(
  guard: Entry | undefined,
  metrics: readonly string[],
): { message: string; fix: string } | undefined {
  if (guard === undefined) {
    return {
      message:
        "frontmatter guard-metric is missing for a tier idea; a tier change is measured on cost and judge send-backs together",
      fix: `add guard-metric: ${TIER_GUARD_METRIC}`,
    };
  }
  if (guard.value !== TIER_GUARD_METRIC) {
    return {
      message: `frontmatter guard-metric is ${guard.value}, not the judge send-backs metric`,
      fix: `use ${TIER_GUARD_METRIC}`,
    };
  }
  return metrics.includes(guard.value)
    ? undefined
    : {
        message: `frontmatter guard-metric ${guard.value} is not a flow report metric`,
        fix: `use one of ${metrics.join(", ")} (see \`harness flow report --json\`)`,
      };
}

/** Problems of a tier idea: one that declares only cost, names a field beyond model or effort, or guards on the wrong metric. */
export function tierProblems(
  file: string,
  keys: Keys,
  metrics: readonly string[],
): Finding[] {
  const change = keys.get("tier-change");
  const guard = keys.get("guard-metric");
  const at = (key: string) => keys.get(key)?.line ?? change?.line ?? 1;
  const problems: Finding[] = [];
  const bad = (key: string, message: string, fix: string) =>
    problems.push(finding(file, at(key), message, fix));
  if (change === undefined) {
    if (guard !== undefined) {
      bad(
        "guard-metric",
        "frontmatter guard-metric has no tier-change",
        "add tier-change: model or effort, or remove the line",
      );
    }
    return problems;
  }
  if (keys.get("kind")?.value !== "harness") {
    bad(
      "tier-change",
      "frontmatter tier-change needs kind: harness",
      "add kind: harness with the hypothesis fields, or remove the line",
    );
  }
  const stray = change.value
    .split(",")
    .map((field) => field.trim())
    .find((field) => !TIER_FIELDS.includes(field));
  if (stray !== undefined) {
    bad(
      "tier-change",
      `frontmatter tier-change names ${stray}; a tier change edits only model or effort in an agent definition's frontmatter`,
      "use model, effort or model, effort",
    );
  }
  const cost = keys.get("hypothesis-metric");
  if (cost !== undefined && cost.value !== TIER_COST_METRIC) {
    bad(
      "hypothesis-metric",
      `frontmatter hypothesis-metric is ${cost.value} on a tier idea; its cost metric is ${TIER_COST_METRIC}`,
      `use ${TIER_COST_METRIC}`,
    );
  }
  const direction = keys.get("hypothesis-direction");
  if (direction !== undefined && direction.value !== "down") {
    bad(
      "hypothesis-direction",
      `frontmatter hypothesis-direction is ${direction.value} on a tier idea, which saves cost`,
      "use down",
    );
  }
  const missing = guardProblem(guard, metrics);
  if (missing !== undefined) {
    bad("guard-metric", missing.message, missing.fix);
  }
  return problems;
}
