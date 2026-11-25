import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { reasonOf, type MissingPrerequisite } from "./preflight-message.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

const READYZ = "/readyz";
const BOUND = "10s";

/**
 * Whether the environment's kube context answers `/readyz` ok over the tailnet,
 * read with one bounded GET. A context that does not answer, or answers
 * something other than `ok`, is missing. Read-only.
 */
export async function kubeProblems(
  repository: Repository,
  runner: Runner,
): Promise<MissingPrerequisite[]> {
  const context = repository.environment.kubeContext;
  const fix = `join kore-agents to the tailnet (tailscale status), check that the ${context} kubeconfig context points at the tailnet address of the API server, then rerun the preflight`;
  let reply: string;
  try {
    const result = await runner.run(
      "kubectl",
      [
        "--context",
        context,
        "get",
        "--raw",
        READYZ,
        `--request-timeout=${BOUND}`,
      ],
      { capture: true },
    );
    reply = result.stdout.trim();
  } catch (error) {
    // An expected failure: an unreachable API server. Named here, not thrown,
    // so the preflight lists it with the other missing prerequisites.
    return [
      {
        name: "tailnet reachability",
        problem: `kubectl --context ${context} get --raw ${READYZ} did not succeed: ${reasonOf(error)}`,
        fix,
      },
    ];
  }
  if (reply === "ok") {
    return [];
  }
  return [
    {
      name: "tailnet reachability",
      problem: `${READYZ} of ${context} replied "${reply}", not ok`,
      fix,
    },
  ];
}
