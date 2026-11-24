// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md
// The opt-in golden-path feasibility eval and its helm render; they need helm and yq. No product path imports this file.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type Environment,
  type Repository,
  nodeCount,
} from "../config/index.js";
import { yamlDocuments } from "./upstream.live.js";
import { rolloutProblems } from "./rollout-feasibility.js";

const run = promisify(execFile);

// The feasibility check reads replicas, surge, scheduling and budgets, never the
// image digest, so the render uses fixed digests of the right shape.
const frontendImage = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bffImage = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;

/**
 * Renders the golden-path-workload chart with the flag-on values
 * (`safetyDefaults=true`, ADR 0154) and returns its manifests. It reads the
 * chart from the repository and runs no cluster command.
 */
export async function renderGoldenPathWorkload(
  repository: Repository,
): Promise<unknown[]> {
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(repository.root, "infra/charts/golden-path-workload"),
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontendImage}`,
    "--set",
    `bff.image=${bffImage}`,
    "--set",
    "safetyDefaults=true",
  ]);
  return yamlDocuments(stdout);
}

/**
 * The rollout-feasibility eval for the golden-path workload (ADR 0036, ADR
 * 0154). `render` returns the parsed manifests of the flag-on golden render,
 * which is the render that ships once golden-path-safety-defaults turns on; the
 * live renderer is `renderGoldenPathWorkload`. The node count is the
 * environment's declared `nodeCount` (ADR 0152), read as one when unset.
 * Returns the reasons the workload cannot roll out or drain, each naming its
 * workload; an empty list is a pass. A failed render rejects, never passes.
 */
export async function goldenPathFeasibility(
  environment: Environment,
  render: () => Promise<unknown[]>,
): Promise<string[]> {
  const manifests = await render();
  return rolloutProblems(manifests, nodeCount(environment));
}
