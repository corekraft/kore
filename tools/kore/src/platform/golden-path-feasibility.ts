// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md

import { type Environment, nodeCount } from "../config/index.js";
import { rolloutProblems } from "./rollout-feasibility.js";

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
