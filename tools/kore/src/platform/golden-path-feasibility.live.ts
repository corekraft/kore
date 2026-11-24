// Helpers for the opt-in golden-path feasibility spec; they need helm and yq.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Repository } from "../config/index.js";
import { yamlDocuments } from "./upstream.live.js";

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
